import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import type { Book, BooksResponse } from '../src/server/books.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';

interface CirculationCase {
  joinId: string;
  title: string;
  copies: number;
  out: number;
  holds: number;
  onShelf: number;
  available: boolean;
}

const CASES: CirculationCase[] = [
  {
    joinId: 'zero-holds',
    title: 'Zero Holds',
    copies: 1,
    out: 0,
    holds: 0,
    onShelf: 1,
    available: true,
  },
  {
    joinId: 'one-hold',
    title: 'One Hold',
    copies: 1,
    out: 0,
    holds: 1,
    onShelf: 1,
    available: false,
  },
  {
    joinId: 'many-holds',
    title: 'Many Holds',
    copies: 1,
    out: 0,
    holds: 5,
    onShelf: 1,
    available: false,
  },
  {
    joinId: 'many-copies',
    title: 'Many Copies',
    copies: 5,
    out: 0,
    holds: 4,
    onShelf: 5,
    available: true,
  },
  {
    joinId: 'equal-holds',
    title: 'Equal Holds',
    copies: 5,
    out: 2,
    holds: 3,
    onShelf: 3,
    available: false,
  },
  {
    joinId: 'zero-copies',
    title: 'Zero Copies',
    copies: 0,
    out: 0,
    holds: 0,
    onShelf: 0,
    available: false,
  },
  {
    joinId: 'all-out',
    title: 'All Out',
    copies: 3,
    out: 3,
    holds: 0,
    onShelf: 0,
    available: false,
  },
];

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-availability-'));
  const config = loadConfig({ dataDir });
  const db = openDatabase(config);

  const insert = db.prepare(
    `INSERT INTO book_records (
       join_id, title, author, publisher, year, description, copies, out, holds,
       first_seen_at, last_refreshed_at
     ) VALUES (?, ?, 'An Author', NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
  );
  for (const entry of CASES) {
    insert.run(
      entry.joinId,
      entry.title,
      entry.copies,
      entry.out,
      entry.holds,
      '2026-11-01T00:00:00.000Z',
      '2026-11-10T09:00:00.000Z',
    );
  }
  db.close();

  app = await buildApp({ dataDir, serveStatic: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function byTitle(items: Book[], title: string): Book {
  const book = items.find((item) => item.title === title);
  expect(book, `expected book "${title}"`).toBeDefined();
  return book as Book;
}

describe('availability derivation over HTTP', () => {
  it('derives available from on-shelf copies exceeding holds', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/books?limit=50&offset=0',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as BooksResponse;
    expect(body.total).toBe(CASES.length);

    for (const entry of CASES) {
      expect(byTitle(body.books, entry.title)).toMatchObject({
        copies: entry.copies,
        out: entry.out,
        holds: entry.holds,
        onShelf: entry.onShelf,
        available: entry.available,
      });
    }
  });

  it('uses the same rule on the single-book endpoint', async () => {
    for (const entry of CASES) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/books/${entry.joinId}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json() as Book).toMatchObject({
        onShelf: entry.onShelf,
        available: entry.available,
      });
    }
  });
});
