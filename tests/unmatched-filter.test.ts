import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import type { BooksResponse } from '../src/server/books.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { seedDatabase } from '../src/server/seed.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-unmatched-filter-'));
  const config = loadConfig({ dataDir });
  const db = openDatabase(config);
  seedDatabase(db, { coversDir: config.coversDir });
  db.close();

  app = await buildApp({ dataDir, serveStatic: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function listBooks(query = ''): Promise<BooksResponse> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/books${query}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as BooksResponse;
}

function titles(body: BooksResponse): string[] {
  return body.books.map((book) => book.title);
}

describe('unmatched filter', () => {
  it('defaults to all books', async () => {
    const body = await listBooks();

    expect(body.total).toBe(6);
    expect(titles(body)).toContain('In Cold Blood');
  });

  it('hides unmatched books', async () => {
    const body = await listBooks('?unmatched=hide');

    expect(body.total).toBe(5);
    expect(titles(body)).not.toContain('In Cold Blood');
  });

  it('keeps only unmatched books', async () => {
    const body = await listBooks('?unmatched=only');

    expect(body.total).toBe(1);
    expect(titles(body)).toEqual(['In Cold Blood']);
  });

  it('combines with free-text search', async () => {
    expect(titles(await listBooks('?unmatched=hide&q=tolkien'))).toEqual([
      'The Hobbit',
    ]);
    expect((await listBooks('?unmatched=only&q=tolkien')).total).toBe(0);
  });

  it('combines with another filter category', async () => {
    expect((await listBooks('?unmatched=hide&tag=nonfiction')).total).toBe(0);
    expect(titles(await listBooks('?unmatched=only&tag=nonfiction'))).toEqual([
      'In Cold Blood',
    ]);
  });

  it('accepts an explicit all value', async () => {
    const body = await listBooks('?unmatched=all');

    expect(body.total).toBe(6);
  });

  it('falls back to all books for an unknown value', async () => {
    expect((await listBooks('?unmatched=HIDE')).total).toBe(6);
    expect((await listBooks('?unmatched=bogus')).total).toBe(6);
    expect((await listBooks('?unmatched=')).total).toBe(6);
  });
});
