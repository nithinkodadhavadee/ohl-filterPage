import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import type { BooksResponse, FacetsResponse } from '../src/server/books.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { seedDatabase } from '../src/server/seed.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-filters-'));
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

describe('author filter', () => {
  it('matches a case-insensitive substring of the author name', async () => {
    expect(titles(await listBooks('?author=orwell'))).toEqual([
      'Nineteen Eighty-Four',
    ]);
    expect(titles(await listBooks('?author=ORWELL'))).toEqual([
      'Nineteen Eighty-Four',
    ]);
    expect(titles(await listBooks('?author=le%20gu'))).toEqual([
      'The Left Hand of Darkness',
    ]);
  });

  it('excludes records with no author', async () => {
    expect(titles(await listBooks('?author=random%20house'))).toEqual([]);
  });
});

describe('tag filter', () => {
  it('matches a single Libib tag', async () => {
    const fiction = await listBooks('?tag=fiction');
    expect(fiction.total).toBe(5);
    expect(titles(fiction)).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'The Hobbit',
      'The Left Hand of Darkness',
    ]);

    expect(titles(await listBooks('?tag=nonfiction'))).toEqual([
      'In Cold Blood',
    ]);
  });

  it('combines multiple tags as OR within the category', async () => {
    const body = await listBooks('?tag=classics&tag=fantasy');

    expect(body.total).toBe(2);
    expect(titles(body)).toEqual(['Nineteen Eighty-Four', 'The Hobbit']);
  });

  it('is case-insensitive', async () => {
    expect(titles(await listBooks('?tag=CLASSICS'))).toEqual([
      'Nineteen Eighty-Four',
    ]);
  });
});

describe('holds buckets', () => {
  it('buckets zero holds', async () => {
    const body = await listBooks('?holds=0');

    expect(body.total).toBe(3);
    expect(titles(body)).toEqual([
      'In Cold Blood',
      'Nineteen Eighty-Four',
      'The Hobbit',
    ]);
  });

  it('buckets one and two holds together', async () => {
    const body = await listBooks('?holds=1-2');

    expect(body.total).toBe(2);
    expect(titles(body)).toEqual([
      'Kavalier & Clay',
      'The Adivasi Will Not Dance',
    ]);
  });

  it('buckets three to five holds and six or more holds', async () => {
    expect(titles(await listBooks('?holds=3-5'))).toEqual([
      'The Left Hand of Darkness',
    ]);
    expect(titles(await listBooks('?holds=6%2B'))).toEqual([]);
  });

  it('combines multiple buckets as OR within the category', async () => {
    const body = await listBooks('?holds=1-2&holds=3-5');

    expect(body.total).toBe(3);
    expect(titles(body)).toEqual([
      'Kavalier & Clay',
      'The Adivasi Will Not Dance',
      'The Left Hand of Darkness',
    ]);
  });

  it('ignores unknown buckets', async () => {
    const body = await listBooks('?holds=99');

    expect(body.total).toBe(6);
  });
});

describe('available-only', () => {
  it('keeps only records where on-shelf copies exceed holds', async () => {
    const body = await listBooks('?available_only=1');

    expect(body.total).toBe(3);
    expect(titles(body)).toEqual([
      'In Cold Blood',
      'Nineteen Eighty-Four',
      'The Hobbit',
    ]);
  });

  it('accepts an explicit false value', async () => {
    expect((await listBooks('?available_only=0')).total).toBe(6);
  });

  it('combines with holds and free-text search', async () => {
    const body = await listBooks('?available_only=1&holds=0&q=the');

    expect(body.total).toBe(2);
    expect(titles(body)).toEqual(['The Hobbit', 'Nineteen Eighty-Four']);
  });
});

describe('combining categories', () => {
  it('combines tags, holds and availability as AND across categories', async () => {
    const body = await listBooks(
      '?tag=fiction&holds=0&available_only=1',
    );

    expect(body.total).toBe(2);
    expect(titles(body)).toEqual(['Nineteen Eighty-Four', 'The Hobbit']);
  });

  it('combines author with a tag as AND', async () => {
    const body = await listBooks('?author=orwell&tag=fiction');

    expect(body.total).toBe(1);
    expect(titles(body)).toEqual(['Nineteen Eighty-Four']);
  });

  it('returns nothing when categories cannot both be satisfied', async () => {
    expect(
      (await listBooks('?author=orwell&tag=nonfiction')).total,
    ).toBe(0);
  });
});

describe('filters compose with sort and pagination', () => {
  it('sorts the filtered set and pages through it', async () => {
    const first = await listBooks(
      '?tag=fiction&sort=holds&direction=desc&limit=2&offset=0',
    );
    expect(first.total).toBe(5);
    expect(titles(first)).toEqual([
      'The Left Hand of Darkness',
      'The Adivasi Will Not Dance',
    ]);
    expect(first.nextOffset).toBe(2);

    const second = await listBooks(
      '?tag=fiction&sort=holds&direction=desc&limit=2&offset=2',
    );
    expect(titles(second)).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
    ]);
    expect(second.nextOffset).toBe(4);

    const last = await listBooks(
      '?tag=fiction&sort=holds&direction=desc&limit=2&offset=4',
    );
    expect(titles(last)).toEqual(['The Hobbit']);
    expect(last.nextOffset).toBeNull();
  });
});

describe('GET /api/facets', () => {
  it('returns Libib tags with book counts', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/facets' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as FacetsResponse;
    expect(body.tags).toEqual([
      { value: 'caste', count: 1 },
      { value: 'classics', count: 1 },
      { value: 'comics', count: 1 },
      { value: 'fantasy', count: 1 },
      { value: 'fiction', count: 5 },
      { value: 'nonfiction', count: 1 },
      { value: 'science fiction', count: 1 },
      { value: 'true crime', count: 1 },
    ]);
  });

  it('returns author suggestions derived from stored records', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/facets' });
    const body = response.json() as FacetsResponse;

    expect(body.authors).toEqual([
      { value: 'George Orwell', count: 1 },
      { value: 'Hansda Sowvendra Shekhar', count: 1 },
      { value: 'J.R.R. Tolkien', count: 1 },
      { value: 'Michael Chabon', count: 1 },
      { value: 'Ursula K. Le Guin', count: 1 },
    ]);
  });
});
