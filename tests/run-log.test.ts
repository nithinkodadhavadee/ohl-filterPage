import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  scanCatalogue,
  type CatalogueScanDeps,
} from '../src/server/catalogue-scan.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { runEnrichCli } from '../src/server/enrich-cli.js';
import {
  EnrichmentAdapterRegistry,
  type EnrichmentAdapter,
  type EnrichmentCandidate,
} from '../src/server/enrichment.js';
import type { LibibIndexItem } from '../src/server/libib-index.js';
import {
  finishRun,
  readRuns,
  startRun,
} from '../src/server/run-log.js';
import { takeSnapshot } from '../src/server/snapshot.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-run-log-'));
  db = openDatabase(loadConfig({ dataDir }));
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function insertBook(joinId: string, title = 'A Book'): void {
  db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, copies, out, holds, first_seen_at,
      last_refreshed_at, hidden
    ) VALUES (?, ?, 'An Author', 0, 0, 0, '2026-11-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z', 0)
  `).run(joinId, title);
}

function item(joinId: string, title: string): LibibIndexItem {
  return { joinId, title, author: 'An Author', coverUrl: null };
}

function adapter(options: { fail?: boolean } = {}): EnrichmentAdapter {
  return {
    source: 'fake',
    async search(input) {
      if (options.fail) throw new Error('source unavailable');
      const candidate: EnrichmentCandidate = {
        sourceId: '/works/1',
        title: input.title,
        authors: input.author ? [input.author] : [],
        ratingAverage: 4,
        ratingCount: 10,
        pageCount: 200,
        subjects: ['Fiction'],
        editionCount: 1,
      };
      return [candidate];
    },
    async fetch() {
      return {
        ratingAverage: 4,
        ratingCount: 10,
        pageCount: 200,
        subjects: ['Fiction'],
      };
    },
  };
}

describe('run_log migration', () => {
  it('creates the run log table idempotently', () => {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_log'",
      )
      .get();
    expect(table).toBeDefined();

    db.close();
    db = openDatabase(loadConfig({ dataDir }));
    const reopened = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_log'",
      )
      .get();
    expect(reopened).toBeDefined();
  });
});

describe('run log start and finish', () => {
  it('records a successful run with duration and counts', () => {
    const id = startRun(db, {
      kind: 'catalogue_scan',
      trigger: 'startup',
      startedAt: '2026-11-10T10:00:00.000Z',
      note: 'scan',
    });
    finishRun(db, id, {
      status: 'ok',
      counts: { added: 2, removed: 1 },
      finishedAt: '2026-11-10T10:00:05.500Z',
    });

    expect(readRuns(db, 'catalogue_scan')).toEqual([
      {
        id,
        kind: 'catalogue_scan',
        trigger: 'startup',
        status: 'ok',
        startedAt: '2026-11-10T10:00:00.000Z',
        finishedAt: '2026-11-10T10:00:05.500Z',
        duration: 5500,
        counts: { added: 2, removed: 1 },
        error: null,
        note: 'scan',
      },
    ]);
  });

  it('records a failed run with its error', () => {
    const id = startRun(db, {
      kind: 'enrichment_pass',
      trigger: 'scheduled',
      startedAt: '2026-11-10T10:00:00.000Z',
    });
    finishRun(db, id, {
      status: 'failed',
      counts: { enriched: 0, failed: 3 },
      error: 'Open Library unavailable',
      finishedAt: '2026-11-10T10:00:01.000Z',
    });

    expect(readRuns(db, 'enrichment_pass')[0]).toMatchObject({
      status: 'failed',
      error: 'Open Library unavailable',
      counts: { enriched: 0, failed: 3 },
      duration: 1000,
    });
  });

  it('reads recent runs newest first with limit and offset', () => {
    for (let index = 0; index < 5; index += 1) {
      const id = startRun(db, {
        kind: 'snapshot',
        trigger: 'automatic',
        startedAt: `2026-11-10T10:0${index}:00.000Z`,
      });
      finishRun(db, id, {
        status: 'ok',
        finishedAt: `2026-11-10T10:0${index}:01.000Z`,
      });
    }

    expect(
      readRuns(db, 'snapshot', { limit: 2 }).map((entry) => entry.startedAt),
    ).toEqual([
      '2026-11-10T10:04:00.000Z',
      '2026-11-10T10:03:00.000Z',
    ]);
    expect(
      readRuns(db, 'snapshot', { limit: 2, offset: 2 }).map(
        (entry) => entry.startedAt,
      ),
    ).toEqual([
      '2026-11-10T10:02:00.000Z',
      '2026-11-10T10:01:00.000Z',
    ]);
  });
});

describe('job instrumentation', () => {
  it('logs a successful Catalogue scan', async () => {
    const deps: CatalogueScanDeps = {
      fetchIndex: async () => [item('book-1', 'A Book')],
      sampleSize: 0,
      trigger: 'startup',
      now: () => new Date('2026-11-10T10:00:00.000Z'),
    };

    await scanCatalogue(db, deps);

    expect(readRuns(db, 'catalogue_scan')[0]).toMatchObject({
      trigger: 'startup',
      status: 'ok',
      counts: { sampleSize: 1, added: 1, updated: 0, removed: 0 },
      note: 'scan',
    });
  });

  it('logs a failed Catalogue scan and rethrows', async () => {
    await expect(
      scanCatalogue(db, {
        fetchIndex: async () => {
          throw new Error('Libib unavailable');
        },
        trigger: 'scheduled',
      }),
    ).rejects.toThrow('Libib unavailable');

    expect(readRuns(db, 'catalogue_scan')[0]).toMatchObject({
      trigger: 'scheduled',
      status: 'failed',
      error: 'Libib unavailable',
    });
  });

  it('logs a successful Enrichment pass with counts', async () => {
    insertBook('book-1');

    const result = await runEnrichCli(['--all'], {
      db,
      adapters: new EnrichmentAdapterRegistry([adapter()]),
      trigger: 'startup',
      now: () => new Date('2026-11-10T10:00:00.000Z'),
      log: () => {},
      error: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(readRuns(db, 'enrichment_pass')[0]).toMatchObject({
      trigger: 'startup',
      status: 'ok',
      note: 'all',
      counts: { enriched: 1, unmatched: 0, failed: 0, total: 1, processed: 1 },
    });
  });

  it('logs a failed Enrichment pass with its error', async () => {
    insertBook('book-1');

    const result = await runEnrichCli(['--all'], {
      db,
      adapters: new EnrichmentAdapterRegistry([adapter({ fail: true })]),
      trigger: 'scheduled',
      now: () => new Date('2026-11-10T10:00:00.000Z'),
      log: () => {},
      error: () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(readRuns(db, 'enrichment_pass')[0]).toMatchObject({
      trigger: 'scheduled',
      status: 'failed',
      counts: { enriched: 0, unmatched: 0, failed: 1, total: 1 },
      error: '1 of 1 book record(s) failed to enrich.',
    });
  });

  it('logs a snapshot', () => {
    const config = loadConfig({ dataDir });
    takeSnapshot(db, config, {
      trigger: 'manual',
      now: () => new Date('2026-11-10T10:00:00.000Z'),
    });

    expect(readRuns(db, 'snapshot')[0]).toMatchObject({
      trigger: 'manual',
      status: 'ok',
    });
  });
});
