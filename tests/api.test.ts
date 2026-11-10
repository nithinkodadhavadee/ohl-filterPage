import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import type { Book, BooksResponse } from '../src/server/books.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { seedDatabase } from '../src/server/seed.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-'));
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

function findByTitle(items: Book[], title: string): Book {
  const book = items.find((item) => item.title === title);
  expect(book, `expected seeded book "${title}"`).toBeDefined();
  return book as Book;
}

describe('seed command', () => {
  it('is idempotent', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'open-house-library-seed-'));
    const config = loadConfig({ dataDir: dir });
    const db = openDatabase(config);

    try {
      seedDatabase(db, { coversDir: config.coversDir });
      seedDatabase(db, { coversDir: config.coversDir });

      const books = db
        .prepare('SELECT COUNT(*) AS count FROM book_records')
        .get() as { count: number };
      const subjects = db
        .prepare('SELECT COUNT(*) AS count FROM book_subjects')
        .get() as { count: number };
      const search = db
        .prepare('SELECT COUNT(*) AS count FROM books_fts')
        .get() as { count: number };

      expect(books.count).toBe(6);
      expect(subjects.count).toBe(15);
      expect(search.count).toBe(6);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('GET /health', () => {
  it('reports the app, database and background-status health', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      database: 'ok',
      crawler: {
        enabled: false,
        healthy: true,
        backoff: false,
        lastOutcome: null,
        lastError: null,
      },
      startup: null,
      scheduled: null,
    });
  });
});

describe('GET /api/books', () => {
  it('returns the documented page shape', async () => {
    const body = await listBooks();

    expect(body.total).toBe(6);
    expect(body.books).toHaveLength(6);
    expect(body.nextOffset).toBeNull();
    expect(body.meta.lastIndexRefreshedAt).toBe('2026-11-10T09:30:00.000Z');
  });

  it('maps a book record, its enrichment and its Libib link', async () => {
    const body = await listBooks();
    const book = findByTitle(body.books, 'Nineteen Eighty-Four');

    expect(book).toMatchObject({
      joinId: '167806440',
      title: 'Nineteen Eighty-Four',
      author: 'George Orwell',
      publisher: 'Penguin',
      year: 1949,
      copies: 3,
      out: 1,
      holds: 0,
      onShelf: 2,
      available: true,
      pageCount: 328,
      rating: { average: 4.28, count: 449, lowSample: false },
      enrichmentSource: 'Open Library',
      libibUrl: 'https://www.libib.com/u/openhouselibrary?solo=167806440',
    });
    expect(book.coverUrl).toBe('/covers/nineteen-eighty-four.svg');
    expect(book.tags).toEqual(['classics', 'fiction']);
    expect(book.subjects).toEqual([
      'Dystopia',
      'Political fiction',
      'Totalitarianism',
    ]);
    expect(book.refreshedAt).toBe('2026-11-10T09:00:00.000Z');
  });

  it('links every book with the encoded solo permalink', async () => {
    const body = await listBooks();

    expect(body.books).toHaveLength(6);
    for (const book of body.books) {
      expect(book.libibUrl).toBe(
        `https://www.libib.com/u/openhouselibrary?solo=${encodeURIComponent(
          book.joinId,
        )}`,
      );
      expect(book.libibUrl).not.toContain('?id=');
    }
  });

  it('derives availability from copies, out and holds', async () => {
    const body = await listBooks();

    const available = findByTitle(body.books, 'The Hobbit');
    expect(available).toMatchObject({
      copies: 4,
      out: 3,
      holds: 0,
      onShelf: 1,
      available: true,
    });

    const held = findByTitle(body.books, 'The Adivasi Will Not Dance');
    expect(held).toMatchObject({
      copies: 1,
      out: 0,
      holds: 2,
      onShelf: 1,
      available: false,
    });

    const longQueue = findByTitle(body.books, 'The Left Hand of Darkness');
    expect(longQueue).toMatchObject({
      copies: 1,
      out: 0,
      holds: 5,
      onShelf: 1,
      available: false,
    });

    const fullyOut = findByTitle(body.books, 'Kavalier & Clay');
    expect(fullyOut).toMatchObject({
      copies: 2,
      out: 2,
      holds: 1,
      onShelf: 0,
      available: false,
    });
  });

  it('decodes entity-encoded titles and tolerates missing metadata', async () => {
    const body = await listBooks();
    const book = findByTitle(body.books, 'Kavalier & Clay');

    expect(book.title).toBe('Kavalier & Clay');
    expect(book.publisher).toBeNull();
    expect(book.year).toBeNull();
    expect(book.coverUrl).toBeNull();
  });

  it('labels unmatched records with no rating, subjects or page count', async () => {
    const body = await listBooks();
    const book = findByTitle(body.books, 'In Cold Blood');

    expect(book.rating).toBeNull();
    expect(book.subjects).toEqual([]);
    expect(book.pageCount).toBeNull();
    expect(book.enrichmentSource).toBeNull();
    expect(book.author).toBeNull();
    expect(book.tags).toEqual(['nonfiction', 'true crime']);
  });

  it('flags ratings with fewer than five contributions as low-sample', async () => {
    const body = await listBooks();

    expect(findByTitle(body.books, 'The Adivasi Will Not Dance').rating).toEqual({
      average: 5,
      count: 1,
      lowSample: true,
    });
    expect(
      findByTitle(body.books, 'The Left Hand of Darkness').rating,
    ).toEqual({
      average: 3.8,
      count: 4,
      lowSample: true,
    });
  });

  it('pages with limit and offset and reports the next offset', async () => {
    const first = await listBooks('?limit=2&offset=0');
    expect(first.books).toHaveLength(2);
    expect(first.total).toBe(6);
    expect(first.nextOffset).toBe(2);

    const second = await listBooks('?limit=2&offset=2');
    expect(second.books).toHaveLength(2);
    expect(second.nextOffset).toBe(4);

    const last = await listBooks('?limit=2&offset=4');
    expect(last.books).toHaveLength(2);
    expect(last.nextOffset).toBeNull();
  });

  it('pages stably across every sort without duplicates or gaps', async () => {
    const sorts = [
      'title',
      'author',
      'rating',
      'holds',
      'year',
      'pageCount',
      'random',
    ];

    for (const sort of sorts) {
      const query = `?sort=${sort}&direction=asc&seed=paging-seed`;
      const all = await listBooks(query);
      const joinIds: string[] = [];
      let offset: number | null = 0;
      let guard = 0;

      while (offset !== null && guard < 10) {
        const page = await listBooks(`${query}&limit=2&offset=${offset}`);
        expect(page.total).toBe(all.total);
        expect(page.nextOffset).not.toBe(offset);
        joinIds.push(...page.books.map((entry) => entry.joinId));
        offset = page.nextOffset;
        guard += 1;
      }

      expect(offset).toBeNull();
      expect(joinIds).toEqual(all.books.map((entry) => entry.joinId));
      expect(new Set(joinIds).size).toBe(joinIds.length);
      expect(joinIds).toHaveLength(all.total);
    }
  });
});

describe('GET /api/books/:joinId', () => {
  it('returns one book', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/books/167806440',
    });

    expect(response.statusCode).toBe(200);
    const book = response.json() as Book;
    expect(book.title).toBe('Nineteen Eighty-Four');
    expect(book.available).toBe(true);
  });

  it('returns 404 for an unknown book', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/books/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('cached covers', () => {
  it('serves a seeded cover from DATA_DIR/covers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/covers/nineteen-eighty-four.svg',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/svg+xml');
  });
});
