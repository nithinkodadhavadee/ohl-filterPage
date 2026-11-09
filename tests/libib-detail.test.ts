import { describe, expect, it } from 'vitest';
import {
  LIBIB_USER_AGENT,
  LibibRequestError,
} from '../src/server/libib-index.js';
import {
  fetchBookDetail,
  parseDetailEnvelope,
  parseDetailItemInfo,
  truncateDetailMarkup,
  type DetailEnvelope,
} from '../src/server/libib-detail.js';
import { readFixture } from './fixtures.js';

function detailHtml(name: string): string {
  return readFixture<DetailEnvelope>(name)['item-info'] ?? '';
}

function detail(name: string) {
  return parseDetailEnvelope(readFixture<DetailEnvelope>(name));
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

describe('parseDetailItemInfo', () => {
  it('parses year, publisher, circulation, tags and status from a recorded detail', () => {
    expect(detail('libib-detail-1984-with-year.json')).toMatchObject({
      joinId: '167806440',
      title: '1984',
      author: 'George Orwell',
      year: 2017,
      publisher: 'PENGUIN RANDOMHOUSE INDIA',
      copies: 2,
      out: 2,
      holds: 5,
      tags: ['fiction'],
      statusLabel: 'Unavailable',
    });
  });

  it('parses an available record with multiple tags and no status wrapper', () => {
    expect(detail('libib-detail-adivasi-with-year.json')).toMatchObject({
      title: 'The Adivasi Will Not Dance',
      year: 2017,
      publisher: 'Speaking Tiger',
      copies: 1,
      out: 0,
      holds: 2,
      tags: ['caste', 'fiction'],
    });

    const abundance = detail('libib-detail-abundance-available.json');
    expect(abundance).toMatchObject({
      title: 'Abundance',
      year: 2014,
      publisher: 'Simon and Schuster',
      copies: 1,
      out: 0,
      holds: 0,
      tags: ['nonfiction'],
      statusLabel: null,
    });
  });

  it('tolerates a missing year, publisher, description and author', () => {
    expect(detail('libib-detail-in-cold-blood-missing-year.json')).toMatchObject({
      title: 'In Cold Blood',
      author: null,
      publisher: null,
      year: null,
      description: null,
      copies: 1,
      out: 0,
      holds: 0,
      tags: ['fiction'],
    });
  });

  it('tolerates a missing tag block and absent metadata', () => {
    expect(detail('libib-detail-bare.json')).toMatchObject({
      title: 'Bare Minimum',
      author: null,
      publisher: null,
      year: null,
      description: null,
      tags: [],
      copies: 0,
      out: 0,
      holds: 0,
      statusLabel: null,
    });
  });

  it('decodes entities in the title, author, publisher, tags and description', () => {
    expect(detail('libib-detail-edge-cases.json')).toMatchObject({
      title: 'Fish & Chips',
      author: "A'uthor & Co",
      publisher: 'Publishers & Sons',
      description: 'A fish & chip mystery \u2014 no script here.',
      tags: ['sci-fi & fantasy', 'nonfiction'],
    });
  });

  it('truncates script noise before parsing the description', () => {
    const html = detailHtml('libib-detail-1984-with-year.json');
    const markup = truncateDetailMarkup(html);

    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('document.ready');

    const parsed = parseDetailItemInfo(html);
    expect(parsed?.description).toContain('BRAND NEW');
    expect(parsed?.description).not.toContain('document');
    expect(parsed?.description).not.toContain('setTimeout');

    const edge = detail('libib-detail-edge-cases.json');
    expect(edge?.description).not.toContain('must never be parsed');
  });

  it('returns null when the detail markup has no title', () => {
    expect(parseDetailItemInfo('<div class="item-dv details-view"></div>')).toBeNull();
    expect(parseDetailItemInfo('')).toBeNull();
  });
});

describe('fetchBookDetail', () => {
  it('posts the join id without cookies and parses the recorded response', async () => {
    const calls: { url: string; body: string; cookie: string | null; userAgent: string | null }[] =
      [];
    const fixtures: Record<string, DetailEnvelope> = {
      '167806440': readFixture('libib-detail-1984-with-year.json'),
      '168848474': readFixture('libib-detail-in-cold-blood-missing-year.json'),
    };
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? init.body : '';
      calls.push({
        url,
        body,
        cookie: headers.get('cookie'),
        userAgent: headers.get('user-agent'),
      });
      const joinId = new URLSearchParams(body).get('join_id') ?? '';
      const fixture = fixtures[joinId];
      return fixture
        ? jsonResponse(fixture)
        : jsonResponse({ outcome: 'error' }, { status: 404 });
    }) as typeof fetch;

    const detail = await fetchBookDetail('167806440', { fetchImpl });

    expect(detail).toMatchObject({
      joinId: '167806440',
      title: '1984',
      holds: 5,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/item-details-view$/);
    expect(new URLSearchParams(calls[0].body).get('join_id')).toBe('167806440');
    expect(calls[0].cookie).toBeNull();
    expect(calls[0].userAgent).toBe(LIBIB_USER_AGENT);
  });

  it('returns null when Libib reports a failed outcome', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ outcome: 'error' })) as typeof fetch;

    await expect(fetchBookDetail('167806440', { fetchImpl })).resolves.toBeNull();
  });

  it('stops with a clear error on 429', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: 'rate limited' }, { status: 429 })) as typeof fetch;

    const error = await fetchBookDetail('167806440', { fetchImpl }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LibibRequestError);
    expect((error as LibibRequestError).status).toBe(429);
    expect((error as LibibRequestError).message).toMatch(/libib refused/i);
  });

  it('stops with a clear error on 403', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ error: 'forbidden' }, { status: 403 })) as typeof fetch;

    const error = await fetchBookDetail('167806440', { fetchImpl }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(LibibRequestError);
    expect((error as LibibRequestError).status).toBe(403);
  });
});
