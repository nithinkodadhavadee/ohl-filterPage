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
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-search-'));
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

describe('free-text search', () => {
  it('returns everything when q is empty', async () => {
    const body = await listBooks('?q=');

    expect(body.total).toBe(6);
    expect(titles(body)).toEqual([
      'In Cold Blood',
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'The Hobbit',
      'The Left Hand of Darkness',
    ]);
  });

  it('finds Tolkien through the typo "tolkain"', async () => {
    const body = await listBooks('?q=tolkain');

    expect(body.total).toBe(1);
    expect(titles(body)).toEqual(['The Hobbit']);
  });

  it('finds substring matches in titles, authors and descriptions', async () => {
    expect(titles(await listBooks('?q=olkien'))).toEqual(['The Hobbit']);
    expect(titles(await listBooks('?q=jharkhand'))).toEqual([
      'The Adivasi Will Not Dance',
    ]);
  });

  it('orders results by relevance, with exact title matches first', async () => {
    const body = await listBooks('?q=the');

    expect(titles(body)).toEqual([
      'The Adivasi Will Not Dance',
      'The Hobbit',
      'The Left Hand of Darkness',
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
    ]);
  });
});

describe('sorting', () => {
  it('sorts by title in both directions', async () => {
    const ascending = titles(await listBooks('?sort=title&direction=asc'));
    const descending = titles(await listBooks('?sort=title&direction=desc'));

    expect(ascending).toEqual([
      'In Cold Blood',
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'The Hobbit',
      'The Left Hand of Darkness',
    ]);
    expect(descending).toEqual([...ascending].reverse());
  });

  it('sorts by author with missing authors last in both directions', async () => {
    const ascending = titles(await listBooks('?sort=author&direction=asc'));
    const descending = titles(await listBooks('?sort=author&direction=desc'));

    expect(ascending).toEqual([
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'The Hobbit',
      'Kavalier & Clay',
      'The Left Hand of Darkness',
      'In Cold Blood',
    ]);
    expect(descending).toEqual([
      'The Left Hand of Darkness',
      'Kavalier & Clay',
      'The Hobbit',
      'The Adivasi Will Not Dance',
      'Nineteen Eighty-Four',
      'In Cold Blood',
    ]);
  });

  it('sorts by holds in both directions, using title for ties', async () => {
    const ascending = titles(await listBooks('?sort=holds&direction=asc'));
    const descending = titles(await listBooks('?sort=holds&direction=desc'));

    expect(ascending).toEqual([
      'In Cold Blood',
      'Nineteen Eighty-Four',
      'The Hobbit',
      'Kavalier & Clay',
      'The Adivasi Will Not Dance',
      'The Left Hand of Darkness',
    ]);
    expect(descending).toEqual([
      'The Left Hand of Darkness',
      'The Adivasi Will Not Dance',
      'Kavalier & Clay',
      'In Cold Blood',
      'Nineteen Eighty-Four',
      'The Hobbit',
    ]);
  });

  it('sorts by year with missing years last in both directions', async () => {
    const ascending = titles(await listBooks('?sort=year&direction=asc'));
    const descending = titles(await listBooks('?sort=year&direction=desc'));

    expect(ascending).toEqual([
      'The Hobbit',
      'Nineteen Eighty-Four',
      'In Cold Blood',
      'The Left Hand of Darkness',
      'The Adivasi Will Not Dance',
      'Kavalier & Clay',
    ]);
    expect(descending).toEqual([
      'The Adivasi Will Not Dance',
      'The Left Hand of Darkness',
      'In Cold Blood',
      'Nineteen Eighty-Four',
      'The Hobbit',
      'Kavalier & Clay',
    ]);
  });

  it('keeps random order stable for a given seed across requests and pages', async () => {
    const first = await listBooks('?sort=random&seed=alpha');
    const repeat = await listBooks('?sort=random&seed=alpha');
    const pageOne = await listBooks('?sort=random&seed=alpha&limit=3&offset=0');
    const pageTwo = await listBooks('?sort=random&seed=alpha&limit=3&offset=3');
    const descending = await listBooks(
      '?sort=random&seed=alpha&direction=desc',
    );

    expect(titles(repeat)).toEqual(titles(first));
    expect([...titles(pageOne), ...titles(pageTwo)]).toEqual(titles(first));
    expect(new Set(titles(descending))).toEqual(new Set(titles(first)));
    expect(titles(descending)).toEqual([...titles(first)].reverse());
  });

  it('combines a text query with an explicit sort', async () => {
    const body = await listBooks('?q=the&sort=year&direction=asc');

    expect(titles(body)).toEqual([
      'The Hobbit',
      'Nineteen Eighty-Four',
      'The Left Hand of Darkness',
      'The Adivasi Will Not Dance',
      'Kavalier & Clay',
    ]);
  });

  it('applies the default title order when no sort is supplied', async () => {
    const body = await listBooks();

    expect(titles(body)).toEqual([
      'In Cold Blood',
      'Kavalier & Clay',
      'Nineteen Eighty-Four',
      'The Adivasi Will Not Dance',
      'The Hobbit',
      'The Left Hand of Darkness',
    ]);
  });
});
