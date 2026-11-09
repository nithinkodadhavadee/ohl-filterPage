import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import type { BooksResponse } from '../src/shared/contract.js';
import { isUnmatchedBook } from '../src/shared/contract.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-unmatched-'));
  const config = loadConfig({ dataDir });
  const db = openDatabase(config);

  const insertBook = db.prepare(
    `INSERT INTO book_records (join_id, title, first_seen_at)
     VALUES (?, ?, '2026-11-01T00:00:00.000Z')`,
  );
  insertBook.run('matched-empty', 'A Matched Work');
  insertBook.run('unmatched', 'An Unmatched Work');
  insertBook.run('pending', 'A Pending Work');

  const insertEnrichment = db.prepare(
    `INSERT INTO enrichment (
       join_id, source, rating_average, rating_count, page_count, status, enriched_at
     ) VALUES (?, 'openlibrary', NULL, 0, NULL, ?, '2026-11-02T00:00:00.000Z')`,
  );
  insertEnrichment.run('matched-empty', 'enriched');
  insertEnrichment.run('unmatched', 'unmatched');

  db.close();

  app = await buildApp({ dataDir, serveStatic: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('unmatched signal', () => {
  it('marks a matched work with no rating or subjects as enriched', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/books?limit=50',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as BooksResponse;
    const matched = body.books.find((book) => book.joinId === 'matched-empty');
    expect(matched).toBeDefined();
    expect(matched?.rating).toBeNull();
    expect(matched?.subjects).toEqual([]);
    expect(matched?.enrichmentStatus).toBe('enriched');
    expect(isUnmatchedBook(matched!)).toBe(false);

    const unmatched = body.books.find((book) => book.joinId === 'unmatched');
    expect(unmatched?.enrichmentStatus).toBe('unmatched');
    expect(isUnmatchedBook(unmatched!)).toBe(true);

    const pending = body.books.find((book) => book.joinId === 'pending');
    expect(pending?.enrichmentStatus).toBeNull();
    expect(isUnmatchedBook(pending!)).toBe(true);
  });
});
