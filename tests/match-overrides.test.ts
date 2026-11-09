import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdapterRegistry } from '../src/server/adapters.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { runEnrichCli } from '../src/server/enrich-cli.js';
import {
  EnrichmentAdapterRegistry,
  type EnrichmentAdapter,
  type EnrichmentCandidate,
  type EnrichmentData,
} from '../src/server/enrichment.js';
import { runExportUnmatchedCli } from '../src/server/export-unmatched-cli.js';
import { runOverrideImportCli } from '../src/server/override-cli.js';

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
    ratingAverage: null,
    ratingCount: 0,
    pageCount: null,
    subjects: [],
    ...overrides,
  };
}

describe('match overrides and unmatched export', () => {
  let dataDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-overrides-'));
    db = openDatabase(loadConfig({ dataDir }));
  });

  afterEach(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function insertBook(
    joinId: string,
    title: string,
    author: string | null,
  ): void {
    db.prepare(`
      INSERT INTO book_records (
        join_id, title, author, copies, out, holds, first_seen_at
      ) VALUES (?, ?, ?, 0, 0, 0, '2026-11-01T00:00:00.000Z')
    `).run(joinId, title, author);
  }

  function insertOverride(
    joinId: string,
    source: string,
    sourceId: string,
    note: string | null = null,
  ): void {
    db.prepare(`
      INSERT INTO match_overrides (join_id, source, source_id, note, created_at)
      VALUES (?, ?, ?, ?, '2026-11-02T00:00:00.000Z')
    `).run(joinId, source, sourceId, note);
  }

  function insertEnrichment(joinId: string, status: string): void {
    db.prepare(`
      INSERT INTO enrichment (join_id, source, status)
      VALUES (?, 'fake', ?)
    `).run(joinId, status);
  }

  it('uses a match override instead of automatic search', async () => {
    insertBook('book-1', 'The Hobbit', 'J.R.R. Tolkien');
    insertOverride('book-1', 'fake', '/works/PINNED', 'Librarian pin');

    let searches = 0;
    const fetched: string[] = [];
    const adapter: EnrichmentAdapter = {
      source: 'fake',
      async search() {
        searches += 1;
        return [
          candidate({
            sourceId: '/works/AUTO',
            title: 'The Hobbit',
            authors: ['J.R.R. Tolkien'],
            ratingCount: 99,
          }),
        ];
      },
      async fetch(selected) {
        fetched.push(selected.sourceId);
        return data({
          ratingAverage: 4.5,
          ratingCount: 12,
          pageCount: 310,
          subjects: ['Fantasy'],
          title: 'The Hobbit',
          authors: ['J.R.R. Tolkien'],
        });
      },
    };

    const result = await runEnrichCli(['--id', 'book-1'], {
      db,
      adapters: new EnrichmentAdapterRegistry([adapter]),
      now: () => new Date('2026-11-10T12:00:00.000Z'),
      log: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.outcome?.status).toBe('enriched');
    expect(searches).toBe(0);
    expect(fetched).toEqual(['/works/PINNED']);

    const row = db
      .prepare('SELECT * FROM enrichment WHERE join_id = ?')
      .get('book-1') as Record<string, unknown>;
    expect(row).toMatchObject({
      source: 'fake',
      source_id: '/works/PINNED',
      matched_title: 'The Hobbit',
      matched_author: 'J.R.R. Tolkien',
      rating_average: 4.5,
      rating_count: 12,
      page_count: 310,
      status: 'enriched',
    });
  });

  it('keeps the override and pinned result across re-enrichment', async () => {
    insertBook('book-1', 'The Hobbit', 'J.R.R. Tolkien');
    insertOverride('book-1', 'fake', '/works/PINNED', 'Keep me');

    let searches = 0;
    const adapter: EnrichmentAdapter = {
      source: 'fake',
      async search() {
        searches += 1;
        return [
          candidate({
            sourceId: '/works/AUTO',
            title: 'The Hobbit',
            authors: ['J.R.R. Tolkien'],
          }),
        ];
      },
      async fetch() {
        return data({
          ratingAverage: 4,
          ratingCount: 8,
          subjects: ['Fantasy'],
        });
      },
    };
    const deps = {
      db,
      adapters: new EnrichmentAdapterRegistry([adapter]),
      now: () => new Date('2026-11-10T12:00:00.000Z'),
      log: () => {},
    };

    expect((await runEnrichCli(['--id', 'book-1'], deps)).exitCode).toBe(0);
    expect((await runEnrichCli(['--id', 'book-1'], deps)).exitCode).toBe(0);

    expect(searches).toBe(0);
    const override = db
      .prepare('SELECT * FROM match_overrides WHERE join_id = ?')
      .get('book-1') as Record<string, unknown>;
    expect(override).toMatchObject({
      source: 'fake',
      source_id: '/works/PINNED',
      note: 'Keep me',
    });

    const enrichment = db
      .prepare('SELECT source_id, status FROM enrichment WHERE join_id = ?')
      .get('book-1') as Record<string, unknown>;
    expect(enrichment).toMatchObject({
      source_id: '/works/PINNED',
      status: 'enriched',
    });
    expect(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM match_overrides WHERE join_id = ?',
          )
          .get('book-1') as { count: number }
      ).count,
    ).toBe(1);
  });

  it('imports valid override rows and reports invalid rows with line numbers', () => {
    insertBook('book-1', 'The Hobbit', 'J.R.R. Tolkien');
    insertBook('book-2', 'A Book', 'An Author');
    insertBook('book-3', 'Another Book', 'Another Author');

    const csvPath = path.join(dataDir, 'overrides.csv');
    writeFileSync(
      csvPath,
      [
        'join_id,source,source_id_or_url,note',
        'book-1,openlibrary,https://openlibrary.org/works/OL1168083W,first pin',
        'book-1,openlibrary,OL1168083W,second pin',
        '',
        'missing-book,openlibrary,OL1W,',
        'book-2,unknownsource,OL2W,',
        'book-3,openlibrary,not-a-work-url,',
        '',
      ].join('\n'),
      'utf8',
    );

    const logs: string[] = [];
    const errors: string[] = [];
    const result = runOverrideImportCli([csvPath], {
      db,
      adapters: createAdapterRegistry(),
      now: () => new Date('2026-11-10T12:00:00.000Z'),
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    });

    expect(result.exitCode).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.issues.map((issue) => issue.line)).toEqual([5, 6, 7]);
    expect(errors[0]).toMatch(/^Line 5: Unknown book record "missing-book"\./);
    expect(errors[1]).toMatch(/^Line 6: Unknown enrichment source "unknownsource"\./);
    expect(errors[2]).toMatch(/^Line 7: Invalid source record id or URL/);
    expect(logs[0]).toMatch(/Imported 1 new and updated 1 match override/);

    const overrides = db
      .prepare('SELECT * FROM match_overrides')
      .all() as Record<string, unknown>[];
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      join_id: 'book-1',
      source: 'openlibrary',
      source_id: '/works/OL1168083W',
      note: 'second pin',
    });
  });

  it('exports exactly the documented columns for unmatched and missing books', () => {
    insertBook('book-missing', 'Missing, "Quoted" Title', null);
    insertBook('book-unmatched', 'Unmatched Book', 'An Author');
    insertBook('book-enriched', 'Enriched Book', 'An Author');
    insertBook('book-failed', 'Failed Book', 'An Author');
    insertEnrichment('book-unmatched', 'unmatched');
    insertEnrichment('book-enriched', 'enriched');
    insertEnrichment('book-failed', 'failed');

    let output = '';
    const result = runExportUnmatchedCli([], {
      db,
      stdout: (text) => {
        output += text;
      },
      error: () => {},
    });

    expect(result).toMatchObject({ exitCode: 0, count: 2, outPath: null });
    expect(output.trimEnd().split('\n')).toEqual([
      'join_id,title,author',
      'book-missing,"Missing, ""Quoted"" Title",',
      'book-unmatched,Unmatched Book,An Author',
    ]);
    expect(output).not.toContain('Enriched Book');
    expect(output).not.toContain('Failed Book');
  });

  it('writes the export to --out', () => {
    insertBook('book-missing', 'Missing Book', 'An Author');
    const outPath = path.join(dataDir, 'unmatched.csv');
    const logs: string[] = [];

    const result = runExportUnmatchedCli(['--out', outPath], {
      db,
      log: (line) => logs.push(line),
      error: () => {},
    });

    expect(result).toMatchObject({ exitCode: 0, count: 1, outPath });
    expect(readFileSync(outPath, 'utf8')).toBe(
      'join_id,title,author\nbook-missing,Missing Book,An Author\n',
    );
    expect(logs[0]).toMatch(/Wrote 1 unmatched book record/);
  });
});
