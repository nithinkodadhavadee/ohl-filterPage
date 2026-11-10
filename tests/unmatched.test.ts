import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import type { BooksResponse } from '../src/shared/contract.js';
import {
  hasNoEnrichmentData,
  isUnmatchedBook,
} from '../src/shared/contract.js';

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
  insertBook.run('failed', 'A Failed Work');
  insertBook.run('pending', 'A Pending Work');

  const insertEnrichment = db.prepare(
    `INSERT INTO enrichment (
       join_id, source, source_id, rating_average, rating_count, page_count,
       status, enriched_at
     ) VALUES (?, 'openlibrary', ?, NULL, 0, NULL, ?,
       '2026-11-02T00:00:00.000Z')`,
  );
  insertEnrichment.run('matched-empty', '/works/OL1W', 'enriched');
  insertEnrichment.run('unmatched', null, 'unmatched');
  insertEnrichment.run('failed', null, 'failed');

  db.close();

  app = await buildApp({ dataDir, serveStatic: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('unmatched signal', () => {
  it('treats only a confirmed no-match as unmatched', async () => {
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
    expect(matched?.enrichmentSourceUrl).toBe(
      'https://openlibrary.org/works/OL1W',
    );
    expect(isUnmatchedBook(matched!)).toBe(false);
    expect(hasNoEnrichmentData(matched!.enrichmentStatus)).toBe(false);

    const unmatched = body.books.find((book) => book.joinId === 'unmatched');
    expect(unmatched?.enrichmentStatus).toBe('unmatched');
    expect(unmatched?.enrichmentSourceUrl).toBeNull();
    expect(isUnmatchedBook(unmatched!)).toBe(true);
    expect(hasNoEnrichmentData(unmatched!.enrichmentStatus)).toBe(true);

    const failed = body.books.find((book) => book.joinId === 'failed');
    expect(failed?.enrichmentStatus).toBe('failed');
    expect(failed?.enrichmentSourceUrl).toBeNull();
    expect(isUnmatchedBook(failed!)).toBe(false);
    expect(hasNoEnrichmentData(failed!.enrichmentStatus)).toBe(true);

    const pending = body.books.find((book) => book.joinId === 'pending');
    expect(pending?.enrichmentStatus).toBeNull();
    expect(isUnmatchedBook(pending!)).toBe(false);
    expect(hasNoEnrichmentData(pending!.enrichmentStatus)).toBe(true);
  });

  it('exposes the source that was tried for every enrichment row', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/books?limit=50',
    });
    const body = response.json() as BooksResponse;

    expect(
      body.books.find((book) => book.joinId === 'matched-empty')
        ?.enrichmentSource,
    ).toBe('Open Library');
    expect(
      body.books.find((book) => book.joinId === 'unmatched')
        ?.enrichmentSource,
    ).toBe('Open Library');
    expect(
      body.books.find((book) => book.joinId === 'failed')?.enrichmentSource,
    ).toBe('Open Library');
    expect(
      body.books.find((book) => book.joinId === 'pending')?.enrichmentSource,
    ).toBeNull();
  });

  it('filters on enrichment status, not on missing rating or subjects', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/books?unmatched=hide',
    });
    const hidden = response.json() as BooksResponse;
    expect(hidden.books.map((book) => book.joinId)).toEqual(['matched-empty']);
    expect(hidden.books[0].rating).toBeNull();
    expect(hidden.books[0].subjects).toEqual([]);

    const onlyResponse = await app.inject({
      method: 'GET',
      url: '/api/books?unmatched=only',
    });
    const only = onlyResponse.json() as BooksResponse;
    expect(only.books.map((book) => book.joinId).sort()).toEqual([
      'failed',
      'pending',
      'unmatched',
    ]);
  });
});
