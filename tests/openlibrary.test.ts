import { describe, expect, it } from 'vitest';
import {
  OPEN_LIBRARY_SEARCH_FIELDS,
  OpenLibraryAdapter,
  OpenLibraryRequestError,
  parseRatingsResponse,
  parseSearchResponse,
  parseWorkResponse,
} from '../src/server/openlibrary.js';
import { readFixture } from './fixtures.js';

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Open Library search parsing', () => {
  it('parses recorded search docs into candidates', () => {
    const candidates = parseSearchResponse(
      readFixture('ol-search-1984-fields.json'),
    );

    expect(candidates).toHaveLength(5);
    expect(candidates[0]).toMatchObject({
      sourceId: '/works/OL1168083W',
      title: 'Nineteen Eighty-Four',
      authors: ['George Orwell'],
      pageCount: 318,
      ratingCount: 447,
      editionCount: 727,
    });
    expect(candidates[0].ratingAverage).toBeCloseTo(4.2818794, 5);
    expect(candidates[0].subjects).toContain('Dystopias');
  });

  it('tolerates missing ratings fields and trailing whitespace', () => {
    const candidates = parseSearchResponse(
      readFixture('ol-search-adivasi-fields.json'),
    );

    expect(candidates[1]).toMatchObject({
      sourceId: '/works/OL42986588W',
      title: 'The Adivasi Will Not Dance',
      authors: ['Hansda Sowvendra Shekhar'],
      pageCount: 210,
      ratingAverage: null,
      ratingCount: null,
      subjects: [],
    });
  });

  it('returns no candidates for a malformed envelope', () => {
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({ docs: 'nope' })).toEqual([]);
  });
});

describe('Open Library work and ratings parsing', () => {
  it('parses work subjects and a string description', () => {
    const work = parseWorkResponse(readFixture('ol-work-1984.json'));

    expect(work).toMatchObject({
      key: '/works/OL1168083W',
      title: 'Nineteen Eighty-Four',
    });
    expect(work?.subjects).toHaveLength(107);
    expect(work?.description).toMatch(/dystopian social science fiction/);
  });

  it('parses the object description shape', () => {
    const work = parseWorkResponse(readFixture('ol-work-adivasi.json'));

    expect(work?.subjects).toEqual([
      'Short stories',
      'Adivasi',
      'Santal (South Asian people)',
      'Fiction',
    ]);
    expect(work?.description).toMatch(/Santhal people/);
  });

  it('parses ratings summary and gates an empty average', () => {
    expect(parseRatingsResponse(readFixture('ol-ratings-1984.json'))).toEqual({
      average: 4.282850779510023,
      count: 449,
    });
    expect(parseRatingsResponse(readFixture('ol-ratings-adivasi.json'))).toEqual({
      average: 5,
      count: 1,
    });
    expect(
      parseRatingsResponse({ summary: { average: 0, count: 0 } }),
    ).toEqual({ average: null, count: 0 });
    expect(parseRatingsResponse({})).toBeNull();
  });
});

describe('OpenLibraryAdapter', () => {
  it('searches with explicit fields and parses the response', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      calls.push(input.toString());
      return jsonResponse(readFixture('ol-search-1984-fields.json'));
    }) as typeof fetch;

    const adapter = new OpenLibraryAdapter({ fetchImpl });
    const candidates = await adapter.search({
      title: 'Nineteen Eighty-Four',
      author: 'George Orwell',
    });

    expect(candidates[0].sourceId).toBe('/works/OL1168083W');
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/search.json');
    expect(url.searchParams.get('title')).toBe('Nineteen Eighty-Four');
    expect(url.searchParams.get('author')).toBe('George Orwell');
    expect(url.searchParams.get('limit')).toBe('10');
    expect(url.searchParams.get('fields')?.split(',')).toEqual(
      OPEN_LIBRARY_SEARCH_FIELDS,
    );
  });

  it('merges work subjects and ratings with the search page count', async () => {
    const candidate = parseSearchResponse(
      readFixture('ol-search-1984-fields.json'),
    )[0];
    const calls: string[] = [];

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      calls.push(url);
      if (url.endsWith('/ratings.json')) {
        return jsonResponse(readFixture('ol-ratings-1984.json'));
      }
      if (url.endsWith('/works/OL1168083W.json')) {
        return jsonResponse(readFixture('ol-work-1984.json'));
      }
      return jsonResponse({ error: 'not found' }, 404);
    }) as typeof fetch;

    const adapter = new OpenLibraryAdapter({ fetchImpl });
    const data = await adapter.fetch(candidate);

    expect(data).toMatchObject({
      pageCount: 318,
      ratingCount: 449,
    });
    expect(data.ratingAverage).toBeCloseTo(4.2828507795, 8);
    expect(data.subjects).toHaveLength(107);
    expect(calls.sort()).toEqual([
      'https://openlibrary.org/works/OL1168083W.json',
      'https://openlibrary.org/works/OL1168083W/ratings.json',
    ]);
  });

  it('falls back to search ratings and subjects when work or ratings are missing', async () => {
    const candidate = parseSearchResponse(
      readFixture('ol-search-1984-fields.json'),
    )[0];

    const fetchImpl = (async () =>
      jsonResponse({ error: 'not found' }, 404)) as typeof fetch;

    const adapter = new OpenLibraryAdapter({ fetchImpl });
    const data = await adapter.fetch(candidate);

    expect(data).toMatchObject({
      ratingAverage: candidate.ratingAverage,
      ratingCount: candidate.ratingCount,
      pageCount: 318,
      subjects: candidate.subjects,
    });
  });

  it('raises a status error on a refused search', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: 'rate limited' }, 429)) as typeof fetch;

    const adapter = new OpenLibraryAdapter({ fetchImpl });
    const error = await adapter
      .search({ title: 'Nineteen Eighty-Four', author: 'George Orwell' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(OpenLibraryRequestError);
    expect((error as OpenLibraryRequestError).status).toBe(429);
  });
});
