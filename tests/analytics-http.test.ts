import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { seedDatabase } from '../src/server/seed.js';
import type { AnalyticsSummary } from '../src/shared/analytics.js';
import type { BooksResponse } from '../src/shared/contract.js';

const HUMAN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

let app: FastifyInstance;
let dataDir: string;
let clientDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-analytics-http-'));
  clientDir = mkdtempSync(path.join(tmpdir(), 'open-house-analytics-client-'));
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(
    path.join(clientDir, 'index.html'),
    '<!doctype html><title>analytics shell</title><div id="root"></div>',
  );

  const config = loadConfig({ dataDir });
  const db = openDatabase(config);
  seedDatabase(db, { coversDir: config.coversDir });
  db.close();

  app = await buildApp({
    dataDir,
    serveStatic: true,
    clientDir,
    analyticsSettleMs: 0,
  });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(clientDir, { recursive: true, force: true });
});

async function summary(): Promise<AnalyticsSummary> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/analytics/summary',
  });
  expect(response.statusCode).toBe(200);
  return response.json() as AnalyticsSummary;
}

function eventTotal(result: AnalyticsSummary, kind: string): number {
  return result.events.find((entry) => entry.label === kind)?.count ?? 0;
}

describe('visit capture', () => {
  it('records document loads of / and /status only', async () => {
    await app.inject({
      method: 'GET',
      url: '/',
      headers: { 'user-agent': HUMAN_UA, referer: 'https://example.com/a?q=x' },
    });
    await app.inject({
      method: 'GET',
      url: '/status',
      headers: { 'user-agent': HUMAN_UA },
    });
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/api/books' });
    await app.inject({ method: 'GET', url: '/analytics' });

    const result = await summary();
    expect(result.pageViews.total).toBe(2);
    expect(result.pageViews.byPath).toEqual([
      { label: '/', count: 1 },
      { label: '/status', count: 1 },
    ]);
    expect(result.humans).toBe(2);
    expect(result.bots).toBe(0);
    expect(result.referrers).toContainEqual({
      label: 'example.com',
      count: 1,
    });
    expect(result.devices).toContainEqual({ label: 'desktop', count: 2 });
    expect(result.browsers).toContainEqual({ label: 'Chrome', count: 2 });
    expect(result.operatingSystems).toContainEqual({
      label: 'macOS',
      count: 2,
    });
  });

  it('counts Bots separately from human visits', async () => {
    await app.inject({ method: 'GET', url: '/', headers: { 'user-agent': HUMAN_UA } });
    await app.inject({ method: 'GET', url: '/', headers: { 'user-agent': BOT_UA } });

    const result = await summary();
    expect(result.pageViews.total).toBe(2);
    expect(result.humans).toBe(1);
    expect(result.bots).toBe(1);
    expect(result.devices).toEqual([{ label: 'desktop', count: 1 }]);
  });
});

describe('search and filter capture', () => {
  it('records settled Search text once, with result count and zero-result flag', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/books?q=zzzz-unique-miss&offset=0',
      headers: { 'user-agent': HUMAN_UA },
    });
    await app.inject({
      method: 'GET',
      url: '/api/books?q=zzzz-unique-miss&offset=24',
      headers: { 'user-agent': HUMAN_UA },
    });

    const result = await summary();
    expect(result.searches.total).toBe(1);
    expect(result.searches.zeroResults).toBe(1);
    expect(eventTotal(result, 'search')).toBe(1);
    expect(JSON.stringify(result)).not.toContain('zzzz-unique-miss');
  });

  it('records Filter use and sort use when they change at offset zero', async () => {
    await app.inject({ method: 'GET', url: '/api/books?offset=0' });
    await app.inject({
      method: 'GET',
      url: '/api/books?offset=0&sort=year&direction=desc',
    });
    await app.inject({
      method: 'GET',
      url: '/api/books?offset=0&sort=year&direction=desc&available_only=1',
    });
    await app.inject({
      method: 'GET',
      url: '/api/books?offset=24&sort=year&direction=desc&available_only=1',
    });

    const result = await summary();
    expect(eventTotal(result, 'sort')).toBe(1);
    expect(eventTotal(result, 'filter')).toBe(1);
  });

  it('records a non-default sort on the first request and dedupes repeats', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/books?offset=0&sort=year&direction=desc',
      headers: { 'user-agent': HUMAN_UA },
    });
    await app.inject({
      method: 'GET',
      url: '/api/books?offset=0&sort=year&direction=desc',
      headers: { 'user-agent': HUMAN_UA },
    });

    const result = await summary();
    expect(eventTotal(result, 'sort')).toBe(1);
  });

  it('does not treat a first default-sort load as sort use', async () => {
    await app.inject({
      method: 'GET',
      url: '/api/books?offset=0&sort=title&direction=asc',
      headers: { 'user-agent': HUMAN_UA },
    });

    const result = await summary();
    expect(eventTotal(result, 'sort')).toBe(0);
  });
});

describe('book views and errors', () => {
  it('records Book views with titles and captures API errors and 404s', async () => {
    const books = await app.inject({ method: 'GET', url: '/api/books' });
    const body = books.json() as BooksResponse;
    const first = body.books[0];

    await app.inject({
      method: 'GET',
      url: `/api/books/${encodeURIComponent(first.joinId)}`,
      headers: { 'user-agent': HUMAN_UA },
    });
    await app.inject({ method: 'GET', url: '/api/books/does-not-exist' });
    await app.inject({ method: 'GET', url: '/api/runs?kind=nope' });
    await app.inject({ method: 'GET', url: '/missing-page' });

    const result = await summary();
    expect(eventTotal(result, 'book_view')).toBe(1);
    expect(result.mostViewedBooks[0]).toMatchObject({
      joinId: first.joinId,
      title: first.title,
      views: 1,
    });
    expect(eventTotal(result, 'error')).toBe(3);
  });
});

describe('public /analytics', () => {
  it('serves the SPA shell on direct load without counting a visit', async () => {
    const direct = await app.inject({ method: 'GET', url: '/analytics' });
    expect(direct.statusCode).toBe(200);
    expect(direct.body).toContain('analytics shell');

    const trailing = await app.inject({ method: 'GET', url: '/analytics/' });
    expect(trailing.statusCode).toBe(200);

    const result = await summary();
    expect(result.pageViews.total).toBe(0);
  });
});

describe('beacon endpoint', () => {
  const send = (payload: unknown, userAgent = HUMAN_UA) =>
    app.inject({
      method: 'POST',
      url: '/api/analytics/event',
      headers: { 'user-agent': userAgent, 'content-type': 'application/json' },
      payload: JSON.stringify(payload),
    });

  it('accepts the four allowed event types and rejects anything else', async () => {
    expect((await send({ event: 'outbound', destination: 'libib' })).statusCode).toBe(204);
    expect((await send({ event: 'share', result: 'success' })).statusCode).toBe(204);
    expect((await send({ event: 'scroll', quartile: 50 })).statusCode).toBe(204);
    expect((await send({ event: 'filter_reset' })).statusCode).toBe(204);

    expect((await send({ event: 'search' })).statusCode).toBe(400);
    expect(
      (await send({ event: 'outbound', destination: 'elsewhere' })).statusCode,
    ).toBe(400);
    expect((await send({ event: 'scroll', quartile: 30 })).statusCode).toBe(400);
    expect(
      (await send({ event: 'outbound', destination: 'github', q: 'secret' }))
        .statusCode,
    ).toBe(400);

    const result = await summary();
    expect(eventTotal(result, 'outbound')).toBe(1);
    expect(eventTotal(result, 'share')).toBe(1);
    expect(eventTotal(result, 'scroll')).toBe(1);
    expect(eventTotal(result, 'filter_reset')).toBe(1);
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('drops oversized payloads', async () => {
    const response = await send({
      event: 'outbound',
      destination: 'libib',
      pad: 'x'.repeat(4000),
    });
    expect(response.statusCode).toBe(413);
  });

  it('rate limits a client without storing an identifier', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 31; index += 1) {
      const response = await send(
        { event: 'filter_reset' },
        'RateLimitProbe/1.0',
      );
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, 30).every((status) => status === 204)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
