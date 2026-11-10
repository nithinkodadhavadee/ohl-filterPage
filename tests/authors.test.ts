import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseViewState, viewToUrl } from '../src/client/view-state.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import type { FacetsResponse } from '../src/server/books.js';
import {
  buildAuthorFacets,
  splitAuthorNames,
} from '../src/shared/authors.js';
import { createSeededApp, titles, type SeededApp } from './seeded-app.js';

describe('author name splitting', () => {
  it('splits on ampersands and commas, trims and dedupes', () => {
    expect(
      splitAuthorNames('Peter H. Diamandis, Steven Kotler'),
    ).toEqual(['Peter H. Diamandis', 'Steven Kotler']);
    expect(splitAuthorNames('  A. Author & B. Author ,  ')).toEqual([
      'A. Author',
      'B. Author',
    ]);
    expect(splitAuthorNames('Same Name, same name')).toEqual(['Same Name']);
  });

  it('returns no names for empty or missing authors', () => {
    expect(splitAuthorNames(null)).toEqual([]);
    expect(splitAuthorNames('')).toEqual([]);
    expect(splitAuthorNames(' , & ')).toEqual([]);
  });
});

describe('author facet grouping', () => {
  it('groups case-insensitively, counts book records and shows the most common spelling', () => {
    const authors = buildAuthorFacets([
      { joinId: '1', author: 'Peter H. Diamandis, Steven Kotler' },
      { joinId: '2', author: 'Peter H. Diamandis' },
      { joinId: '3', author: 'peter h. diamandis' },
      { joinId: '4', author: 'Steven Kotler' },
    ]);

    expect(authors).toEqual([
      { value: 'Peter H. Diamandis', count: 3 },
      { value: 'Steven Kotler', count: 2 },
    ]);
  });
});

let seeded: SeededApp;

beforeEach(async () => {
  seeded = await createSeededApp('authors');

  const db = openDatabase(loadConfig({ dataDir: seeded.dataDir }));
  try {
    const insert = db.prepare(`
      INSERT INTO book_records (
        join_id, title, author, copies, out, holds, first_seen_at, hidden
      ) VALUES (?, ?, ?, 0, 0, 0, '2026-11-01T00:00:00.000Z', ?)
    `);
    insert.run(
      'coauth-1',
      'Abundance',
      'Peter H. Diamandis, Steven Kotler',
      0,
    );
    insert.run('coauth-2', 'Bold', 'Peter H. Diamandis', 0);
    insert.run('coauth-hidden', 'Hidden Bold', 'Peter H. Diamandis', 1);
    db.prepare(
      'INSERT INTO book_tags (join_id, tag) VALUES (?, ?)',
    ).run('coauth-1', 'fiction');
  } finally {
    db.close();
  }
});

afterEach(async () => {
  await seeded.close();
});

const listBooks = (query = '') => seeded.listBooks(query);

describe('GET /api/facets authors', () => {
  it('returns split names with book counts and the most common spelling', async () => {
    const response = await seeded.app.inject({
      method: 'GET',
      url: '/api/facets',
    });
    const body = response.json() as FacetsResponse;

    expect(body.authors).toContainEqual({
      value: 'Peter H. Diamandis',
      count: 2,
    });
    expect(body.authors).toContainEqual({ value: 'Steven Kotler', count: 1 });
    expect(
      body.authors.filter(
        (author) => author.value.toLowerCase() === 'peter h. diamandis',
      ),
    ).toHaveLength(1);
  });

  it('excludes hidden book records from author counts', async () => {
    const response = await seeded.app.inject({
      method: 'GET',
      url: '/api/facets',
    });
    const body = response.json() as FacetsResponse;

    expect(
      body.authors.find(
        (author) => author.value.toLowerCase() === 'peter h. diamandis',
      )?.count,
    ).toBe(2);
  });
});

describe('author filter', () => {
  it('matches co-authored records from either name', async () => {
    expect(titles(await listBooks('?author=Peter%20H.%20Diamandis'))).toEqual([
      'Abundance',
      'Bold',
    ]);
    expect(titles(await listBooks('?author=Steven%20Kotler'))).toEqual([
      'Abundance',
    ]);
  });

  it('matches author names case-insensitively', async () => {
    expect(titles(await listBooks('?author=peter%20h.%20diamandis'))).toEqual([
      'Abundance',
      'Bold',
    ]);
  });

  it('combines multiple author selections as OR', async () => {
    const body = await listBooks(
      '?author=Peter%20H.%20Diamandis&author=George%20Orwell',
    );

    expect(titles(body)).toEqual([
      'Abundance',
      'Bold',
      'Nineteen Eighty-Four',
    ]);
  });

  it('still combines author selections with other categories as AND', async () => {
    const body = await listBooks(
      '?author=Peter%20H.%20Diamandis&tag=fiction',
    );

    expect(titles(body)).toEqual(['Abundance']);
  });

  it('never returns hidden records', async () => {
    const body = await listBooks('?author=Peter%20H.%20Diamandis');

    expect(titles(body)).not.toContain('Hidden Bold');
  });
});

describe('author URL state', () => {
  it('round-trips multiple selections through the URL', () => {
    const state = parseViewState(
      '?author=Peter%20H.%20Diamandis&author=Steven%20Kotler',
    );

    expect(state.authors).toEqual([
      'Peter H. Diamandis',
      'Steven Kotler',
    ]);

    const url = new URL(viewToUrl(state, '/'), 'http://localhost');
    expect(url.searchParams.getAll('author')).toEqual(state.authors);
    expect(parseViewState(url.search)).toEqual(state);
  });

  it('dedupes selections case-insensitively when parsing a URL', () => {
    const state = parseViewState(
      '?author=Peter%20H.%20Diamandis&author=peter%20h.%20diamandis',
    );

    expect(state.authors).toEqual(['Peter H. Diamandis']);
  });
});
