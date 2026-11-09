import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import {
  authorSurname,
  normalizeTitle,
  selectCandidate,
  type EnrichmentAdapter,
  type EnrichmentCandidate,
  type EnrichmentData,
} from '../src/server/enrichment.js';
import { runEnrichCli } from '../src/server/enrich-cli.js';

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

describe('title and author normalization', () => {
  it('ignores case, punctuation, accents, bracketed qualifiers and leading articles', () => {
    expect(normalizeTitle('The Left Hand of Darkness')).toBe(
      normalizeTitle('left hand of darkness'),
    );
    expect(normalizeTitle('Nineteen Eighty-Four')).toBe(
      normalizeTitle('NINETEEN EIGHTY FOUR'),
    );
    expect(normalizeTitle('1984 (adaptation)')).toBe(normalizeTitle('1984'));
    expect(normalizeTitle('Café & Bar')).toBe('cafe and bar');
  });

  it('extracts an author surname from common name shapes', () => {
    expect(authorSurname('George Orwell')).toBe('orwell');
    expect(authorSurname('Orwell, George')).toBe('orwell');
    expect(authorSurname('Ursula K. Le Guin')).toBe('guin');
    expect(authorSurname('J.R.R. Tolkien')).toBe('tolkien');
    expect(authorSurname('')).toBeNull();
    expect(authorSurname(null)).toBeNull();
  });
});

describe('matching decisions', () => {
  it('matches an exact normalized title and author surname', () => {
    const match = selectCandidate(
      [
        candidate({
          sourceId: '/works/OL1W',
          title: 'The Hobbit',
          authors: ['J.R.R. Tolkien'],
          editionCount: 20,
        }),
      ],
      { title: 'The Hobbit', author: 'J.R.R. Tolkien' },
    );

    expect(match?.sourceId).toBe('/works/OL1W');
  });

  it('rejects a candidate whose author surname does not match', () => {
    const match = selectCandidate(
      [
        candidate({
          sourceId: '/works/OL1W',
          title: 'Nineteen Eighty-Four',
          authors: ['Aldous Huxley'],
          editionCount: 20,
        }),
      ],
      { title: 'Nineteen Eighty-Four', author: 'George Orwell' },
    );

    expect(match).toBeNull();
  });

  it('returns no match when the title differs', () => {
    const match = selectCandidate(
      [
        candidate({
          sourceId: '/works/OL1W',
          title: 'Animal Farm',
          authors: ['George Orwell'],
        }),
      ],
      { title: 'Nineteen Eighty-Four', author: 'George Orwell' },
    );

    expect(match).toBeNull();
  });

  it('picks the highest ratings count when several works qualify', () => {
    const match = selectCandidate(
      [
        candidate({
          sourceId: '/works/OL1W',
          title: '1984',
          authors: ['George Orwell'],
          ratingCount: 10,
          editionCount: 40,
        }),
        candidate({
          sourceId: '/works/OL2W',
          title: '1984',
          authors: ['George Orwell'],
          ratingCount: 30,
          editionCount: 2,
        }),
      ],
      { title: '1984', author: 'George Orwell' },
    );

    expect(match?.sourceId).toBe('/works/OL2W');
  });

  it('rejects a graded-reader adaptation in favour of the real work', () => {
    const match = selectCandidate(
      [
        candidate({
          sourceId: '/works/OLADAPT',
          title: '1984 (adaptation)',
          authors: ['Michael Dean', 'George Orwell'],
          ratingCount: 500,
          editionCount: 1,
        }),
        candidate({
          sourceId: '/works/OLREAL',
          title: '1984',
          authors: ['George Orwell'],
          ratingCount: 10,
          editionCount: 727,
        }),
      ],
      { title: '1984', author: 'George Orwell' },
    );

    expect(match?.sourceId).toBe('/works/OLREAL');
  });

  it('returns no match when the book has no author to match on', () => {
    const match = selectCandidate(
      [
        candidate({
          sourceId: '/works/OL1W',
          title: 'In Cold Blood',
          authors: ['Truman Capote'],
        }),
      ],
      { title: 'In Cold Blood', author: null },
    );

    expect(match).toBeNull();
  });
});

describe('enrich CLI', () => {
  let dataDir: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-enrich-'));
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

  function fakeAdapter(
    matches: EnrichmentCandidate[],
    data: EnrichmentData,
  ): EnrichmentAdapter {
    return {
      source: 'fake',
      async search() {
        return matches;
      },
      async fetch() {
        return data;
      },
    };
  }

  it('stores an enriched row, replaces subjects and is idempotent on rerun', async () => {
    insertBook('book-1', 'The Left Hand of Darkness', 'Ursula K. Le Guin');
    db.prepare(
      'INSERT INTO book_subjects (join_id, subject) VALUES (?, ?)',
    ).run('book-1', 'Old subject');

    const adapter = fakeAdapter(
      [
        candidate({
          sourceId: '/works/OL59863W',
          title: 'The Left Hand of Darkness',
          authors: ['Ursula K. Le Guin'],
          ratingAverage: 3.8,
          ratingCount: 4,
          pageCount: 304,
          editionCount: 90,
        }),
      ],
      {
        ratingAverage: 3.8,
        ratingCount: 4,
        pageCount: 304,
        subjects: ['Science fiction', 'Gender'],
      },
    );
    const now = () => new Date('2026-11-10T12:00:00.000Z');
    const logs: string[] = [];

    const first = await runEnrichCli(['--id', 'book-1'], {
      db,
      adapter,
      now,
      log: (line) => logs.push(line),
    });

    expect(first.exitCode).toBe(0);
    expect(first.outcome?.status).toBe('enriched');
    expect(logs[0]).toMatch(/Enriched book record book-1/);

    const row = db
      .prepare('SELECT * FROM enrichment WHERE join_id = ?')
      .get('book-1') as Record<string, unknown>;
    expect(row).toMatchObject({
      source: 'fake',
      source_id: '/works/OL59863W',
      matched_title: 'The Left Hand of Darkness',
      matched_author: 'Ursula K. Le Guin',
      rating_average: 3.8,
      rating_count: 4,
      page_count: 304,
      status: 'enriched',
      error: null,
      enriched_at: '2026-11-10T12:00:00.000Z',
    });

    const subjects = db
      .prepare(
        'SELECT subject FROM book_subjects WHERE join_id = ? ORDER BY subject',
      )
      .all('book-1') as { subject: string }[];
    expect(subjects.map((entry) => entry.subject)).toEqual([
      'Gender',
      'Science fiction',
    ]);

    const second = await runEnrichCli(['--id', 'book-1'], {
      db,
      adapter,
      now,
      log: () => {},
    });

    expect(second.exitCode).toBe(0);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM enrichment WHERE join_id = ?')
          .get('book-1') as { count: number }
      ).count,
    ).toBe(1);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM book_subjects WHERE join_id = ?')
          .get('book-1') as { count: number }
      ).count,
    ).toBe(2);
  });

  it('records an unmatched row and clears subjects', async () => {
    insertBook('book-2', 'An Obscure Title', 'Nobody Known');
    db.prepare(
      'INSERT INTO book_subjects (join_id, subject) VALUES (?, ?)',
    ).run('book-2', 'Old subject');

    const adapter = fakeAdapter([], {
      ratingAverage: null,
      ratingCount: 0,
      pageCount: null,
      subjects: [],
    });

    const result = await runEnrichCli(['--id=book-2'], {
      db,
      adapter,
      now: () => new Date('2026-11-10T12:30:00.000Z'),
      log: () => {},
    });

    expect(result.exitCode).toBe(0);
    expect(result.outcome?.status).toBe('unmatched');

    const row = db
      .prepare('SELECT * FROM enrichment WHERE join_id = ?')
      .get('book-2') as Record<string, unknown>;
    expect(row).toMatchObject({
      source: 'fake',
      source_id: null,
      matched_title: null,
      matched_author: null,
      rating_average: null,
      rating_count: null,
      page_count: null,
      status: 'unmatched',
      error: null,
      enriched_at: '2026-11-10T12:30:00.000Z',
    });
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM book_subjects WHERE join_id = ?')
          .get('book-2') as { count: number }
      ).count,
    ).toBe(0);
  });

  it('records a failed row and keeps existing subjects for a retry', async () => {
    insertBook('book-3', 'A Book', 'An Author');
    db.prepare(
      'INSERT INTO book_subjects (join_id, subject) VALUES (?, ?)',
    ).run('book-3', 'Kept subject');

    const adapter: EnrichmentAdapter = {
      source: 'fake',
      async search() {
        throw new Error('source unavailable');
      },
      async fetch() {
        throw new Error('unreachable');
      },
    };
    const errors: string[] = [];

    const result = await runEnrichCli(['--id', 'book-3'], {
      db,
      adapter,
      now: () => new Date('2026-11-10T13:00:00.000Z'),
      log: () => {},
      error: (line) => errors.push(line),
    });

    expect(result.exitCode).toBe(1);
    expect(errors[0]).toMatch(/source unavailable/);
    const row = db
      .prepare('SELECT status, error FROM enrichment WHERE join_id = ?')
      .get('book-3') as { status: string; error: string };
    expect(row.status).toBe('failed');
    expect(row.error).toBe('source unavailable');
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS count FROM book_subjects WHERE join_id = ?')
          .get('book-3') as { count: number }
      ).count,
    ).toBe(1);
  });

  it('reports a missing id and an unknown book', async () => {
    const adapter = fakeAdapter([], {
      ratingAverage: null,
      ratingCount: 0,
      pageCount: null,
      subjects: [],
    });
    const errors: string[] = [];

    const missingId = await runEnrichCli([], {
      db,
      adapter,
      error: (line) => errors.push(line),
    });
    expect(missingId.exitCode).toBe(1);
    expect(errors[0]).toMatch(/Usage: npm run enrich/);

    const unknown = await runEnrichCli(['--id', 'nope'], {
      db,
      adapter,
      error: (line) => errors.push(line),
    });
    expect(unknown.exitCode).toBe(1);
    expect(errors[1]).toMatch(/was not found/);
  });
});
