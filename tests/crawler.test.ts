import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.js';
import {
  crawlOne,
  readCrawlerState,
  startCrawler,
  type CrawlerHandle,
} from '../src/server/crawler.js';
import { openDatabase } from '../src/server/db.js';
import type { LibibDetail } from '../src/server/libib-detail.js';
import { LibibRequestError } from '../src/server/libib-index.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-crawler-'));
  db = openDatabase(loadConfig({ dataDir }));
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function detail(overrides: Partial<LibibDetail>): LibibDetail {
  return {
    joinId: '100',
    title: 'A Title',
    author: null,
    publisher: null,
    year: null,
    description: null,
    copies: 0,
    out: 0,
    holds: 0,
    tags: [],
    statusLabel: null,
    ...overrides,
  };
}

function setSample(ids: string[]): void {
  db.prepare('INSERT INTO crawl_state (key, value) VALUES (?, ?)').run(
    'sample_join_ids',
    JSON.stringify(ids),
  );
}

function setState(key: string, value: string): void {
  db.prepare('INSERT INTO crawl_state (key, value) VALUES (?, ?)').run(
    key,
    value,
  );
}

function insertBook(joinId: string): void {
  db.prepare(
    `INSERT INTO book_records (
       join_id, title, first_seen_at
     ) VALUES (?, ?, ?)`,
  ).run(joinId, `Title ${joinId}`, '2026-11-01T00:00:00.000Z');
}

describe('crawlOne', () => {
  it('resumes from the persisted cursor and advances one book at a time', async () => {
    setSample(['100', '101', '102']);
    for (const joinId of ['100', '101', '102']) insertBook(joinId);
    setState('crawl_cursor', '1');
    setState('crawl_cycle_started_at', '2026-11-10T10:00:00.000Z');
    const now = new Date('2026-11-10T10:10:00.000Z');
    const fetched: string[] = [];

    const first = await crawlOne({
      db,
      fetchDetail: async (joinId) => {
        fetched.push(joinId);
        return detail({ joinId, title: `Refreshed ${joinId}` });
      },
      now: () => now,
    });

    expect(fetched).toEqual(['101']);
    expect(first).toMatchObject({
      outcome: 'ok',
      joinId: '101',
      position: 2,
      total: 3,
      cycleFinished: false,
    });
    expect(readCrawlerState(db)).toMatchObject({
      cursor: 2,
      cycleStartedAt: '2026-11-10T10:00:00.000Z',
    });

    const second = await crawlOne({
      db,
      fetchDetail: async (joinId) => {
        fetched.push(joinId);
        return detail({ joinId });
      },
      now: () => now,
    });

    expect(fetched).toEqual(['101', '102']);
    expect(second).toMatchObject({
      outcome: 'ok',
      joinId: '102',
      position: 3,
      total: 3,
      cycleFinished: true,
    });
    expect(readCrawlerState(db)).toMatchObject({
      cursor: 3,
      cycleStartedAt: null,
      lastCycleStartedAt: '2026-11-10T10:00:00.000Z',
      lastCycleFinishedAt: '2026-11-10T10:10:00.000Z',
    });
  });

  it('starts a new cycle after the previous one finishes', async () => {
    setSample(['100', '101']);
    for (const joinId of ['100', '101']) insertBook(joinId);
    setState('crawl_cursor', '2');
    setState('crawl_last_cycle_started_at', '2026-11-10T09:00:00.000Z');
    setState('crawl_last_cycle_finished_at', '2026-11-10T09:30:00.000Z');
    const fetched: string[] = [];

    const result = await crawlOne({
      db,
      fetchDetail: async (joinId) => {
        fetched.push(joinId);
        return detail({ joinId });
      },
      now: () => new Date('2026-11-10T10:00:00.000Z'),
    });

    expect(fetched).toEqual(['100']);
    expect(result).toMatchObject({
      outcome: 'ok',
      joinId: '100',
      position: 1,
      total: 2,
    });
    expect(readCrawlerState(db)).toMatchObject({
      cursor: 1,
      cycleStartedAt: '2026-11-10T10:00:00.000Z',
      lastCycleFinishedAt: '2026-11-10T09:30:00.000Z',
    });
  });

  it('records a throttled outcome without advancing the cursor', async () => {
    setSample(['100', '101']);
    insertBook('100');
    insertBook('101');
    setState('crawl_cursor', '1');

    const result = await crawlOne({
      db,
      fetchDetail: async () => {
        throw new LibibRequestError(429, 'Libib refused rate');
      },
    });

    expect(result).toMatchObject({
      outcome: 'throttled',
      joinId: '101',
      position: 1,
      total: 2,
    });
    expect(readCrawlerState(db)).toMatchObject({
      cursor: 1,
      lastOutcome: 'throttled',
      lastError: 'Libib refused rate',
    });
  });
});

describe('startCrawler', () => {
  it('does nothing when the crawler is disabled', async () => {
    const calls: string[] = [];
    const handle = startCrawler({
      enabled: false,
      db,
      fetchDetail: async (joinId) => {
        calls.push(joinId);
        return null;
      },
    });

    await handle.done;
    expect(calls).toEqual([]);
  });

  it('reads one book per cycle and sleeps for the configured delay', async () => {
    setSample(['100', '101']);
    insertBook('100');
    insertBook('101');
    const calls: string[] = [];
    const sleeps: number[] = [];
    let handle: CrawlerHandle | undefined;

    handle = startCrawler({
      enabled: true,
      db,
      fetchDetail: async (joinId) => {
        calls.push(joinId);
        return detail({ joinId });
      },
      cycleDelayMs: 1000,
      now: () => new Date('2026-11-10T10:00:00.000Z'),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        handle?.stop();
      },
    });

    await handle.done;

    expect(calls).toEqual(['100']);
    expect(sleeps).toEqual([1000]);
    expect(readCrawlerState(db).cursor).toBe(1);
  });

  it('backs off exponentially and persists the attempt when throttled', async () => {
    setSample(['100']);
    insertBook('100');
    const sleeps: number[] = [];
    let calls = 0;
    let handle: CrawlerHandle | undefined;

    handle = startCrawler({
      enabled: true,
      db,
      fetchDetail: async () => {
        calls += 1;
        throw new LibibRequestError(429, 'Libib refused rate');
      },
      cycleDelayMs: 1000,
      maxBackoffMs: 10_000,
      random: () => 0.5,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        if (sleeps.length >= 3) handle?.stop();
      },
    });

    await handle.done;

    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(readCrawlerState(db)).toMatchObject({
      cursor: 0,
      backoffAttempt: 3,
      lastOutcome: 'throttled',
      lastError: 'Libib refused rate',
    });
  });
});
