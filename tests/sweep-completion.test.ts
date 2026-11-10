import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { getBook } from '../src/server/books.js';
import { loadConfig } from '../src/server/config.js';
import {
  crawlOne,
  getCrawlerStatus,
  readCrawlerState,
} from '../src/server/crawler.js';
import { openDatabase } from '../src/server/db.js';
import type { LibibDetail } from '../src/server/libib-detail.js';
import { LibibRequestError } from '../src/server/libib-index.js';
import { readRuns, recordRun } from '../src/server/run-log.js';
import {
  getSweepAuditCsv,
  getSweepLedger,
  listBooksWithoutSuccessfulSweep,
  recordSweepAttempt,
} from '../src/server/sweep-ledger.js';

let dataDir: string;
let db: DatabaseSync;
let app: FastifyInstance | null = null;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-sweep-'));
  db = openDatabase(loadConfig({ dataDir }));
});

afterEach(async () => {
  await app?.close();
  app = null;
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function detail(overrides: Partial<LibibDetail>): LibibDetail {
  return {
    joinId: '100',
    title: 'A Title',
    author: 'An Author',
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
  db.prepare(
    `INSERT INTO crawl_state (key, value) VALUES (?, ?)`,
  ).run(key, value);
}

function insertBook(
  joinId: string,
  title: string,
  options: { hidden?: boolean; lastRefreshedAt?: string | null } = {},
): void {
  db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, copies, out, holds, first_seen_at,
      last_refreshed_at, hidden
    ) VALUES (?, ?, 'An Author', 0, 0, 0, '2026-11-01T00:00:00.000Z', ?, ?)
  `).run(
    joinId,
    title,
    options.lastRefreshedAt ?? null,
    options.hidden ? 1 : 0,
  );
}

describe('Book sweep cycle run log', () => {
  it('records start, finish, duration and refreshed/skipped counts', async () => {
    setSample(['100', '101']);
    insertBook('100', 'First');
    insertBook('101', 'Second');
    let now = new Date('2026-11-10T10:00:00.000Z');

    const first = await crawlOne({
      db,
      now: () => now,
      fetchDetail: async (joinId) =>
        joinId === '100' ? detail({ joinId, title: 'First' }) : null,
    });
    expect(first).toMatchObject({ outcome: 'ok', cycleFinished: false });

    now = new Date('2026-11-10T10:01:00.000Z');
    const second = await crawlOne({
      db,
      now: () => now,
      fetchDetail: async () => null,
    });
    expect(second).toMatchObject({ outcome: 'ok', cycleFinished: true });

    expect(readRuns(db, 'book_sweep_cycle')).toMatchObject([
      {
        kind: 'book_sweep_cycle',
        trigger: 'automatic',
        status: 'ok',
        startedAt: '2026-11-10T10:00:00.000Z',
        finishedAt: '2026-11-10T10:01:00.000Z',
        duration: 60000,
        counts: {
          position: 2,
          total: 2,
          refreshed: 1,
          skipped: 1,
          failed: 0,
        },
        error: null,
        note: 'cycle',
      },
    ]);
  });

  it('records failed attempts and finishes the cycle as partial', async () => {
    setSample(['100']);
    insertBook('100', 'Only');
    let now = new Date('2026-11-10T10:00:00.000Z');

    const failed = await crawlOne({
      db,
      now: () => now,
      fetchDetail: async () => {
        throw new LibibRequestError(429, 'Libib refused rate');
      },
    });

    expect(failed).toMatchObject({
      outcome: 'throttled',
      position: 0,
      total: 1,
      cycleFinished: false,
    });
    expect(readCrawlerState(db).cursor).toBe(0);
    expect(readRuns(db, 'book_sweep_cycle')[0]).toMatchObject({
      status: 'running',
      counts: { position: 0, total: 1, failed: 1 },
      error: 'Libib refused rate',
    });

    now = new Date('2026-11-10T10:00:30.000Z');
    const recovered = await crawlOne({
      db,
      now: () => now,
      fetchDetail: async (joinId) => detail({ joinId }),
    });

    expect(recovered).toMatchObject({
      outcome: 'ok',
      position: 1,
      total: 1,
      cycleFinished: true,
    });
    expect(readRuns(db, 'book_sweep_cycle')).toMatchObject([
      {
        status: 'partial',
        startedAt: '2026-11-10T10:00:00.000Z',
        finishedAt: '2026-11-10T10:00:30.000Z',
        duration: 30000,
        counts: {
          position: 1,
          total: 1,
          refreshed: 1,
          skipped: 0,
          failed: 1,
        },
        error: 'Libib refused rate',
      },
    ]);
  });
});

describe('per-book sweep ledger', () => {
  it('creates the ledger table idempotently and keeps entries across opens', () => {
    insertBook('100', 'Book 100');
    recordSweepAttempt(db, {
      joinId: '100',
      attemptedAt: '2026-11-10T10:00:00.000Z',
      outcome: 'refreshed',
    });

    db.close();
    db = openDatabase(loadConfig({ dataDir }));

    expect(getSweepLedger(db, '100')).toEqual({
      lastAttemptAt: '2026-11-10T10:00:00.000Z',
      outcome: 'refreshed',
      reason: null,
      lastSuccessAt: '2026-11-10T10:00:00.000Z',
    });
  });

  it('records refreshed, skipped and failed outcomes in the crawl path', async () => {
    setSample(['100', '101', '102']);
    for (const joinId of ['100', '101', '102']) {
      insertBook(joinId, `Book ${joinId}`);
    }
    const now = new Date('2026-11-10T10:00:00.000Z');

    await crawlOne({
      db,
      now: () => now,
      fetchDetail: async (joinId) => detail({ joinId }),
    });
    await crawlOne({
      db,
      now: () => now,
      fetchDetail: async () => null,
    });
    const failed = await crawlOne({
      db,
      now: () => now,
      fetchDetail: async () => {
        throw new Error('parse failure');
      },
    });

    expect(failed).toMatchObject({ outcome: 'error', cycleFinished: false });
    expect(getSweepLedger(db, '100')).toMatchObject({
      lastAttemptAt: '2026-11-10T10:00:00.000Z',
      outcome: 'refreshed',
      reason: null,
      lastSuccessAt: '2026-11-10T10:00:00.000Z',
    });
    expect(getSweepLedger(db, '101')).toMatchObject({
      outcome: 'skipped',
      reason: 'Libib returned no detail',
      lastSuccessAt: null,
    });
    expect(getSweepLedger(db, '102')).toMatchObject({
      outcome: 'failed',
      reason: 'parse failure',
      lastSuccessAt: null,
    });
  });

  it('does not let a skip replace a successful refresh, but records a failure', () => {
    insertBook('100', 'Book 100');

    recordSweepAttempt(db, {
      joinId: '100',
      attemptedAt: '2026-11-10T10:00:00.000Z',
      outcome: 'refreshed',
    });
    recordSweepAttempt(db, {
      joinId: '100',
      attemptedAt: '2026-11-10T10:05:00.000Z',
      outcome: 'skipped',
      reason: 'Libib returned no detail',
    });

    expect(getSweepLedger(db, '100')).toEqual({
      lastAttemptAt: '2026-11-10T10:05:00.000Z',
      outcome: 'refreshed',
      reason: null,
      lastSuccessAt: '2026-11-10T10:00:00.000Z',
    });

    recordSweepAttempt(db, {
      joinId: '100',
      attemptedAt: '2026-11-10T10:10:00.000Z',
      outcome: 'failed',
      reason: 'parse failure',
    });

    expect(getSweepLedger(db, '100')).toEqual({
      lastAttemptAt: '2026-11-10T10:10:00.000Z',
      outcome: 'failed',
      reason: 'parse failure',
      lastSuccessAt: '2026-11-10T10:00:00.000Z',
    });
  });

  it('exposes sweep state on a book so an unswept zero is distinguishable', () => {
    insertBook('100', 'Never swept');
    insertBook('101', 'Genuinely empty', {
      lastRefreshedAt: '2026-11-10T10:00:00.000Z',
    });
    recordSweepAttempt(db, {
      joinId: '101',
      attemptedAt: '2026-11-10T10:00:00.000Z',
      outcome: 'refreshed',
    });

    expect(getBook(db, '100')).toMatchObject({
      refreshedAt: null,
      sweep: null,
    });
    expect(getBook(db, '101')).toMatchObject({
      refreshedAt: '2026-11-10T10:00:00.000Z',
      sweep: {
        lastAttemptAt: '2026-11-10T10:00:00.000Z',
        outcome: 'refreshed',
        lastSuccessAt: '2026-11-10T10:00:00.000Z',
      },
    });
  });
});

describe('sweep audit', () => {
  it('lists visible books with no successful sweep and exports CSV', async () => {
    insertBook('a-never', 'A Never');
    insertBook('b-success', 'B Success', {
      lastRefreshedAt: '2026-11-10T10:00:00.000Z',
    });
    insertBook('c-skip', 'C Skip');
    insertBook('d-fail', 'D Fail');
    insertBook('e-hidden', 'E Hidden', { hidden: true });

    recordSweepAttempt(db, {
      joinId: 'b-success',
      attemptedAt: '2026-11-10T10:00:00.000Z',
      outcome: 'refreshed',
    });
    recordSweepAttempt(db, {
      joinId: 'c-skip',
      attemptedAt: '2026-11-10T10:01:00.000Z',
      outcome: 'skipped',
      reason: 'Libib returned no detail',
    });
    recordSweepAttempt(db, {
      joinId: 'd-fail',
      attemptedAt: '2026-11-10T10:02:00.000Z',
      outcome: 'failed',
      reason: 'parse failure',
    });

    expect(listBooksWithoutSuccessfulSweep(db)).toEqual([
      {
        joinId: 'a-never',
        title: 'A Never',
        author: 'An Author',
        lastAttemptAt: null,
        outcome: null,
        reason: null,
      },
      {
        joinId: 'c-skip',
        title: 'C Skip',
        author: 'An Author',
        lastAttemptAt: '2026-11-10T10:01:00.000Z',
        outcome: 'skipped',
        reason: 'Libib returned no detail',
      },
      {
        joinId: 'd-fail',
        title: 'D Fail',
        author: 'An Author',
        lastAttemptAt: '2026-11-10T10:02:00.000Z',
        outcome: 'failed',
        reason: 'parse failure',
      },
    ]);

    const csv = getSweepAuditCsv(db);
    expect(csv.count).toBe(3);
    expect(csv.csv.split('\n')[0]).toBe(
      'join_id,title,author,last_attempt_at,outcome,reason',
    );
    expect(csv.csv).toContain('a-never,A Never,An Author,,,');
    expect(csv.csv).toContain(
      'c-skip,C Skip,An Author,2026-11-10T10:01:00.000Z,skipped,Libib returned no detail',
    );

    app = await buildApp({ dataDir, serveStatic: false });

    const audit = await app.inject({
      method: 'GET',
      url: '/api/sweep/audit',
    });
    expect(audit.statusCode).toBe(200);
    expect((audit.json() as { count: number }).count).toBe(3);

    const download = await app.inject({
      method: 'GET',
      url: '/api/sweep/audit.csv',
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toContain('text/csv');
    expect(download.body).toContain('join_id,title,author');
  });
});

describe('sweep completion status', () => {
  it('reports the last cycle, current progress, pace and last error', () => {
    setSample(['100', '101', '102', '103']);
    setState('crawl_cursor', '2');
    setState('crawl_cycle_started_at', '2026-11-10T10:00:00.000Z');
    setState('crawl_last_progress_at', '2026-11-10T10:01:30.000Z');

    recordRun(db, {
      kind: 'book_sweep_cycle',
      trigger: 'automatic',
      status: 'ok',
      startedAt: '2026-11-10T09:00:00.000Z',
      finishedAt: '2026-11-10T09:00:04.000Z',
      counts: { position: 2, total: 4, refreshed: 2, skipped: 0, failed: 0 },
    });

    const status = getCrawlerStatus(db, {
      now: () => new Date('2026-11-10T10:02:00.000Z'),
      stallThresholdMs: 60000,
    });

    expect(status.cycle).toEqual({
      position: 2,
      total: 4,
      startedAt: '2026-11-10T10:00:00.000Z',
      estimatedRemainingMs: 4000,
      stalled: false,
    });
    expect(status.lastCycle).toEqual({
      startedAt: '2026-11-10T09:00:00.000Z',
      finishedAt: '2026-11-10T09:00:04.000Z',
      duration: 4000,
      counts: { position: 2, total: 4, refreshed: 2, skipped: 0, failed: 0 },
      lastError: null,
    });
  });

  it('marks a cycle stalled when progress is older than the threshold', () => {
    setSample(['100', '101', '102']);
    setState('crawl_cursor', '1');
    setState('crawl_cycle_started_at', '2026-11-10T10:00:00.000Z');
    setState('crawl_last_progress_at', '2026-11-10T10:00:00.000Z');

    const status = getCrawlerStatus(db, {
      now: () => new Date('2026-11-10T10:01:01.000Z'),
      stallThresholdMs: 60000,
    });

    expect(status.cycle.stalled).toBe(true);
    expect(status.cycle.estimatedRemainingMs).toBe(122000);
  });

  it('is not stalled once the cycle has finished', () => {
    setSample(['100']);
    setState('crawl_cursor', '1');
    setState('crawl_cycle_started_at', '2026-11-10T09:00:00.000Z');

    const status = getCrawlerStatus(db, {
      now: () => new Date('2026-11-10T10:00:00.000Z'),
      stallThresholdMs: 60000,
    });

    expect(status.cycle.stalled).toBe(false);
    expect(status.cycle.estimatedRemainingMs).toBe(0);
  });
});
