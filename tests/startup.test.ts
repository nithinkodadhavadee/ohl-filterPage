import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import {
  scanCatalogue,
  type CatalogueScanDeps,
} from '../src/server/catalogue-scan.js';
import { loadConfig } from '../src/server/config.js';
import type { CrawlerHandle } from '../src/server/crawler.js';
import { openDatabase } from '../src/server/db.js';
import { runEnrichCli } from '../src/server/enrich-cli.js';
import {
  EnrichmentAdapterRegistry,
  type EnrichmentAdapter,
  type EnrichmentCandidate,
  type EnrichmentData,
} from '../src/server/enrichment.js';
import type { LibibIndexItem } from '../src/server/libib-index.js';
import { seedDatabase } from '../src/server/seed.js';
import {
  readLastFullEnrichmentAt,
  startStartup,
} from '../src/server/startup.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-startup-'));
  db = openDatabase(loadConfig({ dataDir }));
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function item(
  joinId: string,
  title: string,
  author: string | null = 'An Author',
): LibibIndexItem {
  return { joinId, title, author, coverUrl: null };
}

function indexDeps(
  index: LibibIndexItem[],
  sampleSize = 0,
  now = new Date('2026-11-10T10:00:00.000Z'),
): CatalogueScanDeps {
  return {
    fetchIndex: async () => index,
    sampleSize,
    now: () => now,
  };
}

function insertBook(
  joinId: string,
  title: string,
  options: {
    author?: string | null;
    hidden?: number;
    lastRefreshedAt?: string | null;
  } = {},
): void {
  db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, copies, out, holds, first_seen_at,
      last_refreshed_at, hidden
    ) VALUES (?, ?, ?, 0, 0, 0, '2026-11-01T00:00:00.000Z', ?, ?)
  `).run(
    joinId,
    title,
    options.author === undefined ? 'An Author' : options.author,
    options.lastRefreshedAt ?? '2026-11-01T00:00:00.000Z',
    options.hidden ?? 0,
  );
}

function insertEnrichment(joinId: string, status: string): void {
  db.prepare(`
    INSERT INTO enrichment (join_id, source, status, enriched_at)
    VALUES (?, 'fake', ?, '2026-11-02T00:00:00.000Z')
  `).run(joinId, status);
}

function setSample(ids: string[]): void {
  db.prepare(
    `INSERT INTO crawl_state (key, value) VALUES ('sample_join_ids', ?)`,
  ).run(JSON.stringify(ids));
}

function countRows(table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

function bookRow(joinId: string): Record<string, unknown> | undefined {
  return db
    .prepare('SELECT * FROM book_records WHERE join_id = ?')
    .get(joinId) as Record<string, unknown> | undefined;
}

function enrichmentRow(joinId: string): Record<string, unknown> | undefined {
  return db
    .prepare('SELECT * FROM enrichment WHERE join_id = ?')
    .get(joinId) as Record<string, unknown> | undefined;
}

interface FakeAdapter extends EnrichmentAdapter {
  searches: string[];
  fetches: string[];
}

function fakeAdapter(): FakeAdapter {
  const adapter: FakeAdapter = {
    source: 'fake',
    searches: [],
    fetches: [],
    async search(input) {
      adapter.searches.push(input.title);
      const candidate: EnrichmentCandidate = {
        sourceId: `/works/${input.title.replace(/\s+/g, '-')}`,
        title: input.title,
        authors: input.author ? [input.author] : [],
        ratingAverage: 4,
        ratingCount: 12,
        pageCount: 300,
        subjects: ['Fiction'],
        editionCount: 4,
      };
      return [candidate];
    },
    async fetch(candidate) {
      adapter.fetches.push(candidate.sourceId);
      const data: EnrichmentData = {
        ratingAverage: 4,
        ratingCount: 12,
        pageCount: 300,
        subjects: ['Fiction'],
      };
      return data;
    },
  };
  return adapter;
}

function registry(adapter: EnrichmentAdapter): EnrichmentAdapterRegistry {
  return new EnrichmentAdapterRegistry([adapter]);
}

function fakeSweep(events: string[] = []): CrawlerHandle {
  return {
    stop: () => {
      events.push('sweep:stop');
    },
    done: Promise.resolve(),
  };
}

describe('startup lifecycle', () => {
  it('runs a Catalogue scan, then the Book sweep and full Enrichment pass on an empty database', async () => {
    const events: string[] = [];
    const adapter = fakeAdapter();
    const index = [item('100', 'Abundance'), item('101', 'Beloved')];
    const now = new Date('2026-11-10T10:00:00.000Z');

    let scanFinished = false;
    let releaseEnrichment: () => void = () => {};
    const enrichmentGate = new Promise<void>((resolve) => {
      releaseEnrichment = resolve;
    });
    let enrichmentStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      enrichmentStarted = resolve;
    });

    const handle = startStartup({
      db,
      now: () => now,
      cooldownMs: 3600_000,
      scan: async () => {
        events.push('scan:start');
        await scanCatalogue(db, indexDeps(index, 0, now));
        scanFinished = true;
        events.push('scan:done');
      },
      startSweep: () => {
        events.push('sweep:start');
        return fakeSweep(events);
      },
      enrich: async (context) => {
        events.push('enrich:start');
        expect(scanFinished).toBe(true);
        enrichmentStarted();
        await enrichmentGate;
        return runEnrichCli(['--all'], {
          db,
          adapters: registry(adapter),
          delayMs: 0,
          signal: context.signal,
          log: () => {},
          error: () => {},
        });
      },
    });

    await started;
    expect(events).toEqual([
      'scan:start',
      'scan:done',
      'sweep:start',
      'enrich:start',
    ]);
    expect(handle.status()).toEqual({ inProgress: true, phase: 'enriching' });

    releaseEnrichment();
    await handle.done;

    expect(events).toEqual([
      'scan:start',
      'scan:done',
      'sweep:start',
      'enrich:start',
    ]);
    expect(handle.status()).toEqual({ inProgress: false, phase: 'idle' });
    expect(countRows('book_records')).toBe(2);
    expect(adapter.searches).toEqual(['Abundance', 'Beloved']);
    expect(enrichmentRow('100')).toMatchObject({ status: 'enriched' });
    expect(enrichmentRow('101')).toMatchObject({ status: 'enriched' });
    expect(readLastFullEnrichmentAt(db)).toBe(now.toISOString());
  });

  it('runs a Catalogue scan on a populated database, hiding vanished records', async () => {
    insertBook('099', 'Gone');
    insertBook('100', 'Old Title');

    const handle = startStartup({
      db,
      scan: () =>
        scanCatalogue(
          db,
          indexDeps([
            item('100', 'Abundance'),
            item('101', 'Beloved'),
          ]),
        ),
      startSweep: () => fakeSweep(),
      enrich: async () => {},
    });

    await handle.done;

    expect(bookRow('100')).toMatchObject({ title: 'Abundance', hidden: 0 });
    expect(bookRow('101')).toMatchObject({ title: 'Beloved', hidden: 0 });
    expect(bookRow('099')).toMatchObject({ title: 'Gone', hidden: 1 });
    expect(countRows('book_records')).toBe(3);
  });

  it('skips the full pass within the persisted cooldown, even across a restart', async () => {
    insertBook('100', 'Abundance');
    setSample(['100']);
    const firstAdapter = fakeAdapter();
    const first = startStartup({
      db,
      now: () => new Date('2026-11-10T10:00:00.000Z'),
      cooldownMs: 3600_000,
      scan: async () => {},
      startSweep: () => fakeSweep(),
      enrich: () =>
        runEnrichCli(['--all'], {
          db,
          adapters: registry(firstAdapter),
          delayMs: 0,
          log: () => {},
          error: () => {},
        }),
    });

    await first.done;
    expect(firstAdapter.searches).toEqual(['Abundance']);
    expect(readLastFullEnrichmentAt(db)).toBe('2026-11-10T10:00:00.000Z');

    db.close();
    db = openDatabase(loadConfig({ dataDir }));

    let enrichedAgain = false;
    const second = startStartup({
      db,
      now: () => new Date('2026-11-10T10:30:00.000Z'),
      cooldownMs: 3600_000,
      scan: async () => {},
      startSweep: () => fakeSweep(),
      enrich: async () => {
        enrichedAgain = true;
      },
    });

    await second.done;

    expect(enrichedAgain).toBe(false);
    expect(second.status()).toEqual({ inProgress: false, phase: 'idle' });
    expect(readLastFullEnrichmentAt(db)).toBe('2026-11-10T10:00:00.000Z');
  });

  it('records a completed manual --all pass but not an aborted one', async () => {
    insertBook('100', 'Abundance');
    setSample(['100']);
    const now = new Date('2026-11-10T10:00:00.000Z');

    await runEnrichCli(['--all'], {
      db,
      adapters: registry(fakeAdapter()),
      delayMs: 0,
      now: () => now,
      log: () => {},
      error: () => {},
    });
    expect(readLastFullEnrichmentAt(db)).toBe(now.toISOString());

    db.prepare(
      "DELETE FROM crawl_state WHERE key = 'last_full_enrichment_at'",
    ).run();

    const controller = new AbortController();
    controller.abort();
    await runEnrichCli(['--all'], {
      db,
      adapters: registry(fakeAdapter()),
      delayMs: 0,
      now: () => new Date('2026-11-10T11:00:00.000Z'),
      signal: controller.signal,
      log: () => {},
      error: () => {},
    });
    expect(readLastFullEnrichmentAt(db)).toBeNull();
  });

  it('re-enriches visible records, honours Match overrides and skips hidden books', async () => {
    insertBook('visible', 'Visible Book');
    insertBook('hidden', 'Hidden Book', { hidden: 1 });
    insertBook('already', 'Already Enriched');
    insertEnrichment('already', 'enriched');
    db.prepare(`
      INSERT INTO match_overrides (join_id, source, source_id, note, created_at)
      VALUES ('visible', 'fake', '/works/PINNED', 'Keep me',
        '2026-11-02T00:00:00.000Z')
    `).run();
    setSample(['visible', 'hidden', 'already']);

    const adapter = fakeAdapter();
    const handle = startStartup({
      db,
      scan: async () => {},
      startSweep: () => fakeSweep(),
      enrich: (context) =>
        runEnrichCli(['--all'], {
          db,
          adapters: registry(adapter),
          delayMs: 0,
          signal: context.signal,
          log: () => {},
          error: () => {},
        }),
    });

    await handle.done;

    expect(adapter.fetches).toEqual(['/works/PINNED', '/works/Already-Enriched']);
    expect(adapter.searches).toEqual(['Already Enriched']);
    expect(enrichmentRow('visible')).toMatchObject({
      source_id: '/works/PINNED',
      status: 'enriched',
    });
    expect(enrichmentRow('already')).toMatchObject({ status: 'enriched' });
    expect(
      db.prepare('SELECT note FROM match_overrides WHERE join_id = ?').get('visible'),
    ).toEqual({ note: 'Keep me' });
    expect(enrichmentRow('hidden')).toBeUndefined();
  });

  it('logs scan and Enrichment failures, starts the sweep and never rejects done', async () => {
    const logs: string[] = [];
    let sweepStarted = false;

    const handle = startStartup({
      db,
      logger: (message) => logs.push(message),
      scan: async () => {
        throw new Error('Libib unavailable');
      },
      startSweep: () => {
        sweepStarted = true;
        return fakeSweep();
      },
      enrich: async () => {
        throw new Error('Open Library unavailable');
      },
    });

    await expect(handle.done).resolves.toBeUndefined();

    expect(sweepStarted).toBe(true);
    expect(logs).toEqual([
      'Startup catalogue scan failed: Libib unavailable',
      'Startup Enrichment pass failed: Open Library unavailable',
    ]);
    expect(handle.status()).toEqual({ inProgress: false, phase: 'idle' });
    expect(readLastFullEnrichmentAt(db)).toBeNull();
  });

  it('serves stored data while the startup scan is still running', async () => {
    const seeded = openDatabase(loadConfig({ dataDir }));
    seedDatabase(seeded, { coversDir: loadConfig({ dataDir }).coversDir });
    seeded.close();

    let releaseScan: () => void = () => {};
    const scanGate = new Promise<void>((resolve) => {
      releaseScan = resolve;
    });
    let scanStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      scanStarted = resolve;
    });

    const app: FastifyInstance = await buildApp({
      dataDir,
      serveStatic: false,
      startup: true,
      startupDeps: {
        scan: async () => {
          scanStarted();
          await scanGate;
        },
        enrich: async () => {},
        startSweep: () => fakeSweep(),
      },
    });

    try {
      await started;

      const books = await app.inject({ method: 'GET', url: '/api/books' });
      expect(books.statusCode).toBe(200);
      expect((books.json() as { total: number }).total).toBeGreaterThan(0);

      const status = await app.inject({
        method: 'GET',
        url: '/api/status',
      });
      expect(status.json()).toMatchObject({
        startup: { inProgress: true, phase: 'scanning' },
      });
    } finally {
      releaseScan();
      await app.close();
    }
  });

  it('keeps serving stored data when the startup scan and Enrichment pass fail', async () => {
    const seeded = openDatabase(loadConfig({ dataDir }));
    seedDatabase(seeded, { coversDir: loadConfig({ dataDir }).coversDir });
    seeded.close();

    const app = await buildApp({
      dataDir,
      serveStatic: false,
      startup: true,
      startupDeps: {
        scan: async () => {
          throw new Error('Libib unavailable');
        },
        enrich: async () => {
          throw new Error('Open Library unavailable');
        },
        startSweep: () => fakeSweep(),
      },
    });

    try {
      const books = await app.inject({ method: 'GET', url: '/api/books' });
      expect(books.statusCode).toBe(200);
      expect((books.json() as { total: number }).total).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
