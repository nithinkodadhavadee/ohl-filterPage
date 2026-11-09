import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  refreshCatalogueIndex,
  resampleCatalogueIndex,
  type CatalogueIndexDeps,
} from '../src/server/catalogue-index.js';
import { loadConfig } from '../src/server/config.js';
import { crawlOne } from '../src/server/crawler.js';
import { openDatabase } from '../src/server/db.js';
import { runEnrichCli } from '../src/server/enrich-cli.js';
import {
  EnrichmentAdapterRegistry,
  type EnrichmentAdapter,
  type EnrichmentCandidate,
  type EnrichmentData,
} from '../src/server/enrichment.js';
import type { LibibDetail } from '../src/server/libib-detail.js';
import type { LibibIndexItem } from '../src/server/libib-index.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-enrichment-lifecycle-'));
  db = openDatabase(loadConfig({ dataDir }));
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function candidate(
  overrides: Partial<EnrichmentCandidate> & { sourceId: string; title: string },
): EnrichmentCandidate {
  return {
    authors: [],
    ratingAverage: null,
    ratingCount: null,
    pageCount: null,
    subjects: [],
    editionCount: null,
    ...overrides,
  };
}

function data(overrides: Partial<EnrichmentData> = {}): EnrichmentData {
  return {
    ratingAverage: 4,
    ratingCount: 12,
    pageCount: 300,
    subjects: ['Fiction'],
    ...overrides,
  };
}

function insertBook(
  joinId: string,
  title: string,
  author: string | null = 'An Author',
  lastRefreshedAt: string | null = '2026-11-01T00:00:00.000Z',
): void {
  db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, copies, out, holds, first_seen_at, last_refreshed_at
    ) VALUES (?, ?, ?, 0, 0, 0, '2026-11-01T00:00:00.000Z', ?)
  `).run(joinId, title, author, lastRefreshedAt);
}

function insertEnrichment(joinId: string, status: string): void {
  db.prepare(`
    INSERT INTO enrichment (join_id, source, status, enriched_at)
    VALUES (?, 'fake', ?, '2026-11-02T00:00:00.000Z')
  `).run(joinId, status);
}

function insertOverride(
  joinId: string,
  source: string,
  sourceId: string,
  note = 'Keep me',
): void {
  db.prepare(`
    INSERT INTO match_overrides (join_id, source, source_id, note, created_at)
    VALUES (?, ?, ?, ?, '2026-11-02T00:00:00.000Z')
  `).run(joinId, source, sourceId, note);
}

interface FakeAdapter extends EnrichmentAdapter {
  searches: string[];
  fetches: string[];
  failNextSearch: boolean;
}

function fakeAdapter(): FakeAdapter {
  const adapter: FakeAdapter = {
    source: 'fake',
    searches: [],
    fetches: [],
    failNextSearch: false,
    async search(input) {
      adapter.searches.push(input.title);
      if (adapter.failNextSearch) {
        throw new Error('source unavailable');
      }
      return [
        candidate({
          sourceId: `/works/${input.title.replace(/\s+/g, '-')}`,
          title: input.title,
          authors: input.author ? [input.author] : [],
          ratingAverage: 4,
          ratingCount: 12,
          pageCount: 300,
          editionCount: 4,
        }),
      ];
    },
    async fetch(selected) {
      adapter.fetches.push(selected.sourceId);
      return data();
    },
  };
  return adapter;
}

function registry(adapter: EnrichmentAdapter): EnrichmentAdapterRegistry {
  return new EnrichmentAdapterRegistry([adapter]);
}

function enrichmentRow(joinId: string): Record<string, unknown> | undefined {
  return db
    .prepare('SELECT * FROM enrichment WHERE join_id = ?')
    .get(joinId) as Record<string, unknown> | undefined;
}

describe('bulk enrichment refresh', () => {
  it('enriches the whole sample with --all and reports a summary', async () => {
    insertBook('book-1', 'First Book');
    insertBook('book-2', 'Second Book');
    insertBook('book-3', 'Third Book');
    db.prepare('INSERT INTO crawl_state (key, value) VALUES (?, ?)').run(
      'sample_join_ids',
      JSON.stringify(['book-1', 'book-2', 'book-3']),
    );

    const adapter = fakeAdapter();
    const logs: string[] = [];

    const result = await runEnrichCli(['--all'], {
      db,
      adapters: registry(adapter),
      delayMs: 0,
      now: () => new Date('2026-11-10T12:00:00.000Z'),
      log: (line) => logs.push(line),
      error: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary).toEqual({
      enriched: 3,
      unmatched: 0,
      failed: 0,
    });
    expect(adapter.searches).toEqual([
      'First Book',
      'Second Book',
      'Third Book',
    ]);
    expect(logs.at(-1)).toMatch(
      /Refreshed enrichment for 3 book record\(s\): 3 enriched, 0 unmatched, 0 failed\./,
    );
    for (const joinId of ['book-1', 'book-2', 'book-3']) {
      expect(enrichmentRow(joinId)).toMatchObject({ status: 'enriched' });
    }
  });

  it('selects only missing and unmatched records with --unmatched', async () => {
    insertBook('book-missing', 'Missing Row');
    insertBook('book-unmatched', 'Unmatched Book');
    insertBook('book-enriched', 'Already Enriched');
    insertBook('book-failed', 'Previously Failed');
    insertEnrichment('book-unmatched', 'unmatched');
    insertEnrichment('book-enriched', 'enriched');
    insertEnrichment('book-failed', 'failed');

    const adapter = fakeAdapter();
    const result = await runEnrichCli(['--unmatched'], {
      db,
      adapters: registry(adapter),
      delayMs: 0,
      log: () => {},
      error: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary).toEqual({
      enriched: 2,
      unmatched: 0,
      failed: 0,
    });
    expect(adapter.searches).toEqual(['Missing Row', 'Unmatched Book']);
    expect(enrichmentRow('book-enriched')).toMatchObject({
      status: 'enriched',
    });
    expect(enrichmentRow('book-failed')).toMatchObject({ status: 'failed' });
  });

  it('selects only previously failed records with --failed', async () => {
    insertBook('book-missing', 'Missing Row');
    insertBook('book-unmatched', 'Unmatched Book');
    insertBook('book-enriched', 'Already Enriched');
    insertBook('book-failed', 'Previously Failed');
    insertEnrichment('book-unmatched', 'unmatched');
    insertEnrichment('book-enriched', 'enriched');
    insertEnrichment('book-failed', 'failed');

    const adapter = fakeAdapter();
    const result = await runEnrichCli(['--failed'], {
      db,
      adapters: registry(adapter),
      delayMs: 0,
      log: () => {},
      error: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.summary).toEqual({
      enriched: 1,
      unmatched: 0,
      failed: 0,
    });
    expect(adapter.searches).toEqual(['Previously Failed']);
    expect(enrichmentRow('book-unmatched')).toMatchObject({
      status: 'unmatched',
    });
  });

  it('records a failure and retries it with --failed', async () => {
    insertBook('book-1', 'A Book');
    const failing = fakeAdapter();
    failing.failNextSearch = true;
    const errors: string[] = [];

    const first = await runEnrichCli(['--all'], {
      db,
      adapters: registry(failing),
      delayMs: 0,
      log: () => {},
      error: (line) => errors.push(line),
    });

    expect(first.exitCode).toBe(1);
    expect(first.summary).toEqual({
      enriched: 0,
      unmatched: 0,
      failed: 1,
    });
    expect(errors[0]).toMatch(/source unavailable/);
    expect(enrichmentRow('book-1')).toMatchObject({
      status: 'failed',
      error: 'source unavailable',
    });

    const working = fakeAdapter();
    const retry = await runEnrichCli(['--failed'], {
      db,
      adapters: registry(working),
      delayMs: 0,
      log: () => {},
      error: () => {},
    });

    expect(retry.exitCode).toBe(0);
    expect(retry.summary).toEqual({
      enriched: 1,
      unmatched: 0,
      failed: 0,
    });
    expect(working.searches).toEqual(['A Book']);
    expect(enrichmentRow('book-1')).toMatchObject({
      status: 'enriched',
      error: null,
    });
  });

  it('never overwrites a match override during a bulk refresh', async () => {
    insertBook('book-1', 'The Hobbit', 'J.R.R. Tolkien');
    insertOverride('book-1', 'fake', '/works/PINNED');

    const adapter = fakeAdapter();
    const result = await runEnrichCli(['--all'], {
      db,
      adapters: registry(adapter),
      delayMs: 0,
      log: () => {},
      error: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(adapter.searches).toEqual([]);
    expect(adapter.fetches).toEqual(['/works/PINNED']);

    const override = db
      .prepare('SELECT * FROM match_overrides WHERE join_id = ?')
      .get('book-1') as Record<string, unknown>;
    expect(override).toMatchObject({
      source: 'fake',
      source_id: '/works/PINNED',
      note: 'Keep me',
    });
    expect(enrichmentRow('book-1')).toMatchObject({
      source: 'fake',
      source_id: '/works/PINNED',
      status: 'enriched',
    });
  });
});

describe('first-sight enrichment', () => {
  function item(joinId: string, title: string, author = 'An Author'): LibibIndexItem {
    return { joinId, title, author, coverUrl: null };
  }

  function indexDeps(
    index: LibibIndexItem[],
    adapter: EnrichmentAdapter,
    now = new Date('2026-11-10T10:00:00.000Z'),
  ): CatalogueIndexDeps {
    return {
      fetchIndex: async () => index,
      adapters: registry(adapter),
      now: () => now,
    };
  }

  it('enriches each newly sampled record once and never again', async () => {
    const adapter = fakeAdapter();
    const firstIndex = [item('101', 'Abundance'), item('102', 'Beloved')];

    await refreshCatalogueIndex(db, indexDeps(firstIndex, adapter));

    expect(adapter.searches).toEqual(['Abundance', 'Beloved']);
    for (const joinId of ['101', '102']) {
      expect(enrichmentRow(joinId)).toMatchObject({ status: 'enriched' });
    }

    await refreshCatalogueIndex(db, indexDeps(firstIndex, adapter));

    expect(adapter.searches).toEqual(['Abundance', 'Beloved']);
  });

  it('enriches records newly added by a resample', async () => {
    const adapter = fakeAdapter();
    await refreshCatalogueIndex(
      db,
      indexDeps([item('101', 'Abundance')], adapter),
    );

    await resampleCatalogueIndex(
      db,
      indexDeps(
        [item('101', 'Abundance'), item('103', 'Aardvark')],
        adapter,
        new Date('2026-11-10T11:00:00.000Z'),
      ),
    );

    expect(adapter.searches).toEqual(['Abundance', 'Aardvark']);
    expect(enrichmentRow('103')).toMatchObject({ status: 'enriched' });
  });

  it('enriches a record once before its first crawl detail refresh', async () => {
    db.prepare('INSERT INTO crawl_state (key, value) VALUES (?, ?)').run(
      'sample_join_ids',
      JSON.stringify(['100']),
    );
    insertBook('100', 'A Title', 'An Author', null);

    const adapter = fakeAdapter();
    const detail = (joinId: string): LibibDetail => ({
      joinId,
      title: 'A Title',
      author: 'An Author',
      publisher: null,
      year: null,
      description: null,
      copies: 1,
      out: 0,
      holds: 0,
      tags: [],
      statusLabel: null,
    });

    await crawlOne({
      db,
      adapters: registry(adapter),
      fetchDetail: async (joinId) => detail(joinId),
      now: () => new Date('2026-11-10T10:00:00.000Z'),
    });

    expect(adapter.searches).toEqual(['A Title']);
    expect(enrichmentRow('100')).toMatchObject({ status: 'enriched' });

    await crawlOne({
      db,
      adapters: registry(adapter),
      fetchDetail: async (joinId) => detail(joinId),
      now: () => new Date('2026-11-10T10:10:00.000Z'),
    });

    expect(adapter.searches).toEqual(['A Title']);
  });
});
