import { describe, expect, it } from 'vitest';
import {
  LIBIB_LIBRARY_ID,
  LIBIB_USER_AGENT,
  LibibRequestError,
  fetchCatalogueIndex,
  parseIndexItemInfo,
  parseIndexPage,
  type IndexEnvelope,
  type LibibIndexItem,
} from '../src/server/libib-index.js';
import { readFixture } from './fixtures.js';

interface RecordedCall {
  url: string;
  body: string;
  cookie: string | null;
  userAgent: string | null;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      ...init.headers,
    },
  });
}

function recordedFetch(
  pages: IndexEnvelope[],
  calls: RecordedCall[] = [],
): typeof fetch {
  let pageIndex = 0;
  return (async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({
      url,
      body,
      cookie: headers.get('cookie'),
      userAgent: headers.get('user-agent'),
    });

    if (url.endsWith('/change-sort-order')) {
      return jsonResponse(readFixture('libib-change-sort-order.json'), {
        headers: { 'set-cookie': 'PHPSESSID=session-123; path=/; secure' },
      });
    }

    const page = pages[pageIndex];
    pageIndex += 1;
    if (!page) {
      throw new Error(
        `Unexpected index request for offset ${new URLSearchParams(body).get('offset')}`,
      );
    }
    return jsonResponse(page);
  }) as typeof fetch;
}

describe('parseIndexItemInfo', () => {
  it('parses a recorded index page in returned order', () => {
    const page = readFixture<IndexEnvelope>('libib-index-page-0-raw.json');
    const items = parseIndexItemInfo(page['item-info'] ?? '');

    expect(items).toHaveLength(50);
    expect(items[0]).toEqual({
      joinId: '167806440',
      title: '1984',
      author: 'George Orwell',
      coverUrl:
        'https://d23tvywehq0xq.cloudfront.net/awee42bbc2be4ee507844979e6fa056c19.jpg',
    });
    expect(items[12].title).toBe('The Amazing Adventures of Kavalier & Clay');
    expect(items[49].joinId).toBe('167805615');
  });

  it('decodes entities and turns the a/nil author placeholder into null', () => {
    const page = readFixture<IndexEnvelope>(
      'libib-index-page-trimmed-3-items.json',
    );
    const items = parseIndexItemInfo(page['item-info'] ?? '');

    expect(items).toEqual([
      {
        joinId: '167806440',
        title: '1984',
        author: 'George Orwell',
        coverUrl:
          'https://d23tvywehq0xq.cloudfront.net/awee42bbc2be4ee507844979e6fa056c19.jpg',
      },
      {
        joinId: '170835127',
        title: 'The Absent Color: Poems',
        author: null,
        coverUrl:
          'https://d23tvywehq0xq.cloudfront.net/34b01a950b97de624cbbe69bb05a0ad2ba8b37fe.jpg',
      },
      {
        joinId: '167806446',
        title: 'Abundance',
        author: 'Peter H. Diamandis',
        coverUrl:
          'https://d23tvywehq0xq.cloudfront.net/bdf8c6d9c40237c0ca934c56f5c16f66f6.jpg',
      },
    ]);
  });

  it('tolerates missing authors, missing covers and empty cover URLs', () => {
    const page = readFixture<IndexEnvelope>('libib-index-edge-cases.json');
    const items = parseIndexItemInfo(page['item-info'] ?? '');

    expect(items).toHaveLength(4);
    expect(items[0].title).toBe("Africa's Tarnished Name");
    expect(items[1].title).toBe('Kavalier & Clay');
    expect(items[1].author).toBeNull();
    expect(items[2].author).toBeNull();
    expect(items[2].coverUrl).toBeNull();
    expect(items[3].coverUrl).toBeNull();
  });

  it('reads pagination cursors and the empty flag from the envelope', () => {
    const first = parseIndexPage(
      readFixture<IndexEnvelope>('libib-index-page-0-raw.json'),
    );
    expect(first.empty).toBe(false);
    expect(first.nextOffset).toBe(50);
    expect(first.items).toHaveLength(50);

    const empty = parseIndexPage(
      readFixture<IndexEnvelope>('libib-index-page-empty.json'),
    );
    expect(empty.empty).toBe(true);
    expect(empty.nextOffset).toBe(100);
    expect(empty.items).toEqual([]);
  });
});

describe('fetchCatalogueIndex', () => {
  it('sets title sort, pages until empty and preserves order', async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = recordedFetch(
      [
        readFixture<IndexEnvelope>('libib-index-page-0-raw.json'),
        readFixture<IndexEnvelope>('libib-index-edge-cases.json'),
        readFixture<IndexEnvelope>('libib-index-page-empty.json'),
      ],
      calls,
    );

    const items = await fetchCatalogueIndex({
      fetchImpl,
      delayMs: 0,
    });

    expect(items).toHaveLength(54);
    const firstPage = parseIndexItemInfo(
      readFixture<IndexEnvelope>('libib-index-page-0-raw.json')['item-info'] ?? '',
    );
    expect(items.slice(0, 50).map((item) => item.joinId)).toEqual(
      firstPage.map((item) => item.joinId),
    );
    expect(items.slice(50).map((item) => item.joinId)).toEqual([
      '900000001',
      '900000002',
      '900000003',
      '900000004',
    ]);

    expect(calls[0].url).toMatch(/\/change-sort-order$/);
    expect(new URLSearchParams(calls[0].body).get('sort')).toBe('title_sort_key');
    expect(new URLSearchParams(calls[0].body).get('library_id')).toBe(
      LIBIB_LIBRARY_ID,
    );

    expect(calls[1].url).toMatch(/\/get-account-items$/);
    expect(new URLSearchParams(calls[1].body).get('offset')).toBe('0');
    expect(new URLSearchParams(calls[1].body).get('active_letter')).toBe('ALL');
    expect(new URLSearchParams(calls[2].body).get('offset')).toBe('50');
    expect(new URLSearchParams(calls[3].body).get('offset')).toBe('100');

    for (const call of calls) {
      expect(call.userAgent).toBe(LIBIB_USER_AGENT);
    }
    for (const call of calls.slice(1)) {
      expect(call.cookie).toBe('PHPSESSID=session-123');
    }
  });

  it('aborts on 429 with a useful error', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith('/change-sort-order')) {
        return jsonResponse({ outcome: 'success' });
      }
      return jsonResponse({ error: 'rate limited' }, { status: 429 });
    }) as typeof fetch;

    const error = await fetchCatalogueIndex({ fetchImpl, delayMs: 0 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LibibRequestError);
    expect((error as LibibRequestError).status).toBe(429);
    expect((error as LibibRequestError).message).toMatch(/libib refused/i);
  });

  it('aborts on 403 before reading any items', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: 'forbidden' }, { status: 403 })) as typeof fetch;

    const error = await fetchCatalogueIndex({ fetchImpl, delayMs: 0 }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LibibRequestError);
    expect((error as LibibRequestError).status).toBe(403);
  });

  it('returns an empty list when the first page is empty', async () => {
    const empty = readFixture<IndexEnvelope>('libib-index-page-empty.json');
    const fetchImpl = (async (input: RequestInfo | URL) =>
      input.toString().endsWith('/change-sort-order')
        ? jsonResponse({ outcome: 'success' })
        : jsonResponse(empty)) as typeof fetch;

    const items: LibibIndexItem[] = await fetchCatalogueIndex({
      fetchImpl,
      delayMs: 0,
    });
    expect(items).toEqual([]);
  });
});
