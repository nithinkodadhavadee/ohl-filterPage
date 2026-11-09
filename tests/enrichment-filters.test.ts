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
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-enrichment-'));
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
  return body.items.map((book) => book.title);
}

describe('subject filter', () => {
  it('matches any of the selected subjects as OR', async () => {
    const body = await listBooks('?subject=Fantasy&subject=Comics');

    expect(body.total).toBe(2);
    expect(titles(body)).toEqual(['Kavalier & Clay', 'The Hobbit']);
  });

  it('is case-insensitive', async () => {
    expect(titles(await listBooks('?subject=fantasy'))).toEqual([
      'The Hobbit',
    ]);
  });

  it('combines subjects with tags, availability and author as AND', async () => {
    const available = await listBooks(
      '?subject=Fiction&tag=fiction&available_only=1',
    );
    expect(titles(available)).toEqual(['The Hobbit']);

    const byAuthor = await listBooks('?subject=Dystopia&author=orwell');
    expect(titles(byAuthor)).toEqual(['Nineteen Eighty-Four']);
  });

  it('returns nothing when subject and tag cannot both be satisfied', async () => {
    expect(
      (await listBooks('?subject=Fantasy&tag=nonfiction')).total,
    ).toBe(0);
  });
});

describe('minimum rating filter', () => {
  it('ignores low-sample ratings by default', async () => {
    const body = await listBooks('?rating_min=4');

    expect(body.total).toBe(2);
    expect(titles(body)).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
    ]);
  });

  it('includes low-sample ratings when opted in', async () => {
    const body = await listBooks('?rating_min=4&include_low_sample=1');

    expect(body.total).toBe(3);
    expect(titles(body)).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
    ]);
  });

  it('excludes unrated books whenever a rating filter is active', async () => {
    const body = await listBooks('?rating_min=0&include_low_sample=1');

    expect(body.total).toBe(4);
    expect(titles(body)).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'The Left Hand of Darkness',
    ]);
  });

  it('can still exclude every book through the threshold', async () => {
    expect((await listBooks('?rating_min=4.5')).total).toBe(0);
    expect(
      titles(await listBooks('?rating_min=4.5&include_low_sample=1')),
    ).toEqual(['The Adivasi Will Not Dance']);
  });
});

describe('page count range filter', () => {
  it('applies a minimum and keeps only records with a page count', async () => {
    const body = await listBooks('?pages_min=300');

    expect(titles(body)).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Left Hand of Darkness',
    ]);
  });

  it('applies a maximum', async () => {
    expect(titles(await listBooks('?pages_max=300'))).toEqual([
      'The Adivasi Will Not Dance',
    ]);
  });

  it('applies a range', async () => {
    expect(
      titles(await listBooks('?pages_min=200&pages_max=400')),
    ).toEqual(['Nineteen Eighty-Four', 'The Left Hand of Darkness']);
  });

  it('does not exclude missing page counts unless a bound is set', async () => {
    expect((await listBooks()).total).toBe(6);
    expect(titles(await listBooks('?pages_min=1'))).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'The Left Hand of Darkness',
    ]);
  });

  it('combines the range with a subject filter as AND', async () => {
    expect(
      titles(await listBooks('?pages_min=200&subject=Science%20fiction')),
    ).toEqual(['The Left Hand of Darkness']);
  });
});

describe('rating and page count sorting', () => {
  it('sorts by rating ascending with missing ratings last', async () => {
    expect(titles(await listBooks('?sort=rating&direction=asc'))).toEqual([
      'The Left Hand of Darkness',
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'In Cold Blood',
      'The Hobbit',
    ]);
  });

  it('sorts by rating descending with missing ratings still last', async () => {
    expect(titles(await listBooks('?sort=rating&direction=desc'))).toEqual([
      'The Adivasi Will Not Dance',
      'Nineteen Eighty-Four',
      'Kavalier & Clay',
      'The Left Hand of Darkness',
      'In Cold Blood',
      'The Hobbit',
    ]);
  });

  it('sorts by page count ascending with missing page counts last', async () => {
    expect(
      titles(await listBooks('?sort=pageCount&direction=asc')),
    ).toEqual([
      'The Adivasi Will Not Dance',
      'The Left Hand of Darkness',
      'Nineteen Eighty-Four',
      'Kavalier & Clay',
      'In Cold Blood',
      'The Hobbit',
    ]);
  });

  it('sorts by page count descending with missing page counts still last', async () => {
    expect(
      titles(await listBooks('?sort=pageCount&direction=desc')),
    ).toEqual([
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Left Hand of Darkness',
      'The Adivasi Will Not Dance',
      'In Cold Blood',
      'The Hobbit',
    ]);
  });
});

describe('GET /api/facets subjects', () => {
  it('returns subjects with book counts without disturbing existing facets', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/facets' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as FacetsResponse;
    expect(body.subjects).toEqual([
      { value: 'Adventure', count: 1 },
      { value: 'Caste', count: 1 },
      { value: 'Comics', count: 1 },
      { value: 'Dystopia', count: 1 },
      { value: 'Fantasy', count: 1 },
      { value: 'Fiction', count: 4 },
      { value: 'Gender', count: 1 },
      { value: 'Historical fiction', count: 1 },
      { value: 'Political fiction', count: 1 },
      { value: 'Science fiction', count: 1 },
      { value: 'Short stories', count: 1 },
      { value: 'Totalitarianism', count: 1 },
    ]);
    expect(body.tags).toContainEqual({ value: 'fiction', count: 5 });
    expect(body.authors).toContainEqual({ value: 'George Orwell', count: 1 });
  });
});
