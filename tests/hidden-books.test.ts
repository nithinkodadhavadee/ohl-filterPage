import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import {
  scanCatalogue,
  resampleCatalogue,
  type CatalogueScanDeps,
} from '../src/server/catalogue-scan.js';
import { sweepBookDetails } from '../src/server/circulation.js';
import { loadConfig } from '../src/server/config.js';
import { crawlOne } from '../src/server/crawler.js';
import { openDatabase } from '../src/server/db.js';
import { runEnrichCli } from '../src/server/enrich-cli.js';
import {
  EnrichmentAdapterRegistry,
  type EnrichmentAdapter,
  type EnrichmentData,
} from '../src/server/enrichment.js';
import type { LibibDetail } from '../src/server/libib-detail.js';
import type { LibibIndexItem } from '../src/server/libib-index.js';
import { seedDatabase } from '../src/server/seed.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-hidden-'));
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
): CatalogueScanDeps {
  return {
    fetchIndex: async () => index,
    sampleSize,
    now: () => new Date('2026-11-10T10:00:00.000Z'),
  };
}

function insertBook(joinId: string, title: string, hidden = 0): void {
  db.prepare(
    `INSERT INTO book_records (
       join_id, title, author, copies, out, holds, first_seen_at,
       last_refreshed_at, hidden
     ) VALUES (?, ?, 'An Author', 0, 0, 0, '2026-11-01T00:00:00.000Z',
       '2026-11-01T00:00:00.000Z', ?)`,
  ).run(joinId, title, hidden);
}

function setSample(ids: string[]): void {
  db.prepare(
    `INSERT INTO crawl_state (key, value) VALUES ('sample_join_ids', ?)`,
  ).run(JSON.stringify(ids));
}

function hiddenFlag(joinId: string): number | undefined {
  return (
    db
      .prepare('SELECT hidden FROM book_records WHERE join_id = ?')
      .get(joinId) as { hidden: number } | undefined
  )?.hidden;
}

function countRows(table: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    }
  ).count;
}

function addBookDependents(joinId: string): void {
  db.prepare('INSERT INTO book_tags (join_id, tag) VALUES (?, ?)').run(
    joinId,
    'fiction',
  );
  db.prepare(
    'INSERT INTO book_subjects (join_id, subject) VALUES (?, ?)',
  ).run(joinId, 'Fiction');
  db.prepare(
    `INSERT INTO enrichment (join_id, source, status, enriched_at)
     VALUES (?, 'fake', 'enriched', '2026-11-02T00:00:00.000Z')`,
  ).run(joinId);
  db.prepare(
    `INSERT INTO match_overrides (join_id, source, source_id, note, created_at)
     VALUES (?, 'fake', '/works/PINNED', 'Keep me', '2026-11-02T00:00:00.000Z')`,
  ).run(joinId);
}

function detail(joinId: string): LibibDetail {
  return {
    joinId,
    title: `Title ${joinId}`,
    author: 'An Author',
    publisher: null,
    year: null,
    description: null,
    copies: 1,
    out: 0,
    holds: 0,
    tags: [],
    statusLabel: null,
  };
}

function fakeAdapter(searches: string[]): EnrichmentAdapter {
  const data: EnrichmentData = {
    ratingAverage: 4,
    ratingCount: 10,
    pageCount: 200,
    subjects: [],
  };
  return {
    source: 'fake',
    async search(input) {
      searches.push(input.title);
      return [
        {
          sourceId: `/works/${input.title}`,
          title: input.title,
          authors: input.author ? [input.author] : [],
          ratingAverage: 4,
          ratingCount: 10,
          pageCount: 200,
          subjects: [],
          editionCount: 1,
        },
      ];
    },
    async fetch() {
      return data;
    },
  };
}

describe('Catalogue scan and hidden book records', () => {
  it('hides a vanished record, keeps its rows and override, then unhides it', async () => {
    await scanCatalogue(
      db,
      indexDeps([item('101', 'Abundance'), item('102', 'Beloved')]),
    );
    addBookDependents('102');

    const hidden = await scanCatalogue(
      db,
      indexDeps([item('101', 'Abundance')]),
    );

    expect(hidden.removed).toBe(1);
    expect(hiddenFlag('102')).toBe(1);
    expect(countRows('book_tags')).toBe(1);
    expect(countRows('book_subjects')).toBe(1);
    expect(countRows('enrichment')).toBe(1);
    expect(countRows('match_overrides')).toBe(1);

    const restored = await scanCatalogue(
      db,
      indexDeps([item('101', 'Abundance'), item('102', 'Beloved')]),
    );

    expect(restored.removed).toBe(0);
    expect(hiddenFlag('102')).toBe(0);
    expect(countRows('enrichment')).toBe(1);
    expect(countRows('match_overrides')).toBe(1);
  });

  it('unhides a returning record through the resample path as well', async () => {
    await scanCatalogue(
      db,
      indexDeps([item('201', 'Aardvark'), item('202', 'Beloved')]),
    );
    addBookDependents('202');

    await resampleCatalogue(db, indexDeps([item('201', 'Aardvark')]));
    expect(hiddenFlag('202')).toBe(1);

    await resampleCatalogue(
      db,
      indexDeps([item('201', 'Aardvark'), item('202', 'Beloved')]),
    );
    expect(hiddenFlag('202')).toBe(0);
    expect(countRows('enrichment')).toBe(1);
    expect(countRows('match_overrides')).toBe(1);
  });

  it('stores the whole Collection when SAMPLE_SIZE is 0', async () => {
    const index = [
      item('100', '1984'),
      item('101', 'Abundance'),
      item('102', 'Beloved'),
    ];

    const result = await scanCatalogue(db, indexDeps(index, 0));

    expect(result.sampleSize).toBe(3);
    expect(countRows('book_records')).toBe(3);
  });

  it('caps the Crawl set with the A-first rule when SAMPLE_SIZE is 50', async () => {
    const index = [
      item('100', '1984'),
      ...Array.from({ length: 60 }, (_, number) =>
        item(
          String(200 + number),
          `Alpha ${String(number + 1).padStart(2, '0')}`,
        ),
      ),
    ];

    const result = await scanCatalogue(db, indexDeps(index, 50));

    expect(result.sampleSize).toBe(50);
    expect(countRows('book_records')).toBe(50);
    expect(hiddenFlag('100')).toBeUndefined();
    expect(hiddenFlag('200')).toBe(0);
    expect(hiddenFlag('249')).toBe(0);
    expect(hiddenFlag('250')).toBeUndefined();
  });
});

describe('hidden records in the API', () => {
  let app: FastifyInstance;
  let apiDataDir: string;

  beforeEach(async () => {
    apiDataDir = mkdtempSync(path.join(tmpdir(), 'open-house-hidden-api-'));
    const config = loadConfig({ dataDir: apiDataDir });
    const seeded = openDatabase(config);
    seedDatabase(seeded, { coversDir: config.coversDir });
    seeded
      .prepare('UPDATE book_records SET hidden = 1 WHERE join_id = ?')
      .run('167806440');
    seeded.close();

    app = await buildApp({ dataDir: apiDataDir, serveStatic: false });
  });

  afterEach(async () => {
    await app.close();
    rmSync(apiDataDir, { recursive: true, force: true });
  });

  it('excludes hidden records from books, totals, one-book lookup and facets', async () => {
    const booksResponse = await app.inject({
      method: 'GET',
      url: '/api/books',
    });
    expect(booksResponse.statusCode).toBe(200);
    const books = booksResponse.json() as {
      total: number;
      books: { joinId: string; title: string }[];
    };
    expect(books.total).toBe(5);
    expect(books.books.map((book) => book.title)).not.toContain(
      'Nineteen Eighty-Four',
    );

    const single = await app.inject({
      method: 'GET',
      url: '/api/books/167806440',
    });
    expect(single.statusCode).toBe(404);

    const facetsResponse = await app.inject({
      method: 'GET',
      url: '/api/facets',
    });
    const facets = facetsResponse.json() as {
      tags: { value: string; count: number }[];
      authors: { value: string; count: number }[];
      subjects: { value: string; count: number }[];
    };
    expect(facets.tags.find((entry) => entry.value === 'classics')).toBeUndefined();
    expect(
      facets.tags.find((entry) => entry.value === 'fiction')?.count,
    ).toBe(4);
    expect(
      facets.authors.find((entry) => entry.value === 'George Orwell'),
    ).toBeUndefined();
    expect(
      facets.subjects.find((entry) => entry.value === 'Dystopia'),
    ).toBeUndefined();
  });
});

describe('hidden records are skipped by the sweeps', () => {
  it('skips hidden records in the Book sweep', async () => {
    insertBook('100', 'Visible');
    insertBook('101', 'Hidden', 1);
    setSample(['100', '101']);
    const calls: string[] = [];

    const result = await sweepBookDetails(db, {
      fetchDetail: async (joinId) => {
        calls.push(joinId);
        return detail(joinId);
      },
      delayMs: 0,
    });

    expect(calls).toEqual(['100']);
    expect(result).toEqual({ sampleSize: 1, refreshed: 1, skipped: 0 });
  });

  it('skips hidden records in the rolling crawler', async () => {
    insertBook('100', 'Hidden', 1);
    insertBook('101', 'Visible');
    setSample(['100', '101']);
    const calls: string[] = [];

    const result = await crawlOne({
      db,
      fetchDetail: async (joinId) => {
        calls.push(joinId);
        return detail(joinId);
      },
    });

    expect(calls).toEqual(['101']);
    expect(result).toMatchObject({ joinId: '101', total: 1, position: 1 });
  });

  it('skips hidden records in the Enrichment pass', async () => {
    insertBook('100', 'Visible');
    insertBook('101', 'Hidden', 1);
    setSample(['100', '101']);
    const searches: string[] = [];

    const result = await runEnrichCli(['--all'], {
      db,
      adapters: new EnrichmentAdapterRegistry([fakeAdapter(searches)]),
      delayMs: 0,
      log: () => {},
      error: () => {},
    });

    expect(searches).toEqual(['Visible']);
    expect(result.summary).toEqual({
      enriched: 1,
      unmatched: 0,
      failed: 0,
    });
  });
});

describe('hidden column migration', () => {
  it('adds hidden to an existing database without losing records', () => {
    const legacyDir = mkdtempSync(
      path.join(tmpdir(), 'open-house-hidden-migration-'),
    );
    const config = loadConfig({ dataDir: legacyDir });
    const legacy = new DatabaseSync(config.dbPath);
    legacy.exec(`
      CREATE TABLE book_records (
        join_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT,
        publisher TEXT,
        year INTEGER,
        description TEXT,
        cover_path TEXT,
        copies INTEGER NOT NULL DEFAULT 0,
        out INTEGER NOT NULL DEFAULT 0,
        holds INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        last_refreshed_at TEXT
      );
      INSERT INTO book_records (join_id, title, first_seen_at)
      VALUES ('legacy', 'Legacy Book', '2026-11-01T00:00:00.000Z');
    `);
    legacy.close();

    const migrated = openDatabase(config);
    try {
      const columns = (
        migrated.prepare('PRAGMA table_info(book_records)').all() as unknown as {
          name: string;
        }[]
      ).map((entry) => entry.name);
      expect(columns).toContain('hidden');
      expect(
        migrated
          .prepare('SELECT title, hidden FROM book_records WHERE join_id = ?')
          .get('legacy'),
      ).toEqual({ title: 'Legacy Book', hidden: 0 });
    } finally {
      migrated.close();
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
