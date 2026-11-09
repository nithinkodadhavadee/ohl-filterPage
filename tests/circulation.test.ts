import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refreshBookDetails } from '../src/server/circulation.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { LibibRequestError } from '../src/server/libib-index.js';
import type { LibibDetail } from '../src/server/libib-detail.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-refresh-'));
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

function insertBook(
  joinId: string,
  title: string,
  author: string | null = null,
): void {
  db.prepare(
    `INSERT INTO book_records (
       join_id, title, author, publisher, year, description, copies, out, holds,
       first_seen_at
     ) VALUES (?, ?, ?, NULL, NULL, NULL, 0, 0, 0, ?)`,
  ).run(joinId, title, author, '2026-11-01T00:00:00.000Z');
}

interface BookRow {
  join_id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  description: string | null;
  copies: number;
  out: number;
  holds: number;
  first_seen_at: string;
  last_refreshed_at: string | null;
}

function book(joinId: string): BookRow {
  return db
    .prepare('SELECT * FROM book_records WHERE join_id = ?')
    .get(joinId) as unknown as BookRow;
}

function tags(joinId: string): string[] {
  return (
    db
      .prepare('SELECT tag FROM book_tags WHERE join_id = ? ORDER BY tag')
      .all(joinId) as unknown as { tag: string }[]
  ).map((row) => row.tag);
}

function fts(joinId: string): {
  title: string;
  author: string;
  description: string;
} {
  return db
    .prepare('SELECT title, author, description FROM books_fts WHERE join_id = ?')
    .get(joinId) as unknown as {
    title: string;
    author: string;
    description: string;
  };
}

describe('refreshBookDetails', () => {
  it('upserts circulation, metadata and tags and records last refreshed time', async () => {
    setSample(['100', '101']);
    insertBook('100', 'Old Title', 'Old Author');
    insertBook('101', 'Bare Title', 'Kept Author');
    const now = new Date('2026-11-10T12:00:00.000Z');

    const details: Record<string, LibibDetail> = {
      '100': detail({
        joinId: '100',
        title: 'New Title',
        author: 'New Author',
        publisher: 'A Publisher',
        year: 1999,
        description: 'A description.',
        copies: 3,
        out: 1,
        holds: 2,
        tags: ['fiction', 'classics'],
        statusLabel: 'Unavailable',
      }),
      '101': detail({
        joinId: '101',
        title: 'Bare Title',
        author: null,
        copies: 0,
        out: 0,
        holds: 0,
        tags: [],
      }),
    };

    const result = await refreshBookDetails(db, {
      fetchDetail: async (joinId) => details[joinId],
      now: () => now,
      delayMs: 0,
    });

    expect(result).toEqual({ sampleSize: 2, refreshed: 2, skipped: 0 });
    expect(book('100')).toMatchObject({
      title: 'New Title',
      author: 'New Author',
      publisher: 'A Publisher',
      year: 1999,
      description: 'A description.',
      copies: 3,
      out: 1,
      holds: 2,
      first_seen_at: '2026-11-01T00:00:00.000Z',
      last_refreshed_at: now.toISOString(),
    });
    expect(tags('100')).toEqual(['classics', 'fiction']);
    expect(fts('100')).toEqual({
      title: 'New Title',
      author: 'New Author',
      description: 'A description.',
    });

    expect(book('101')).toMatchObject({
      title: 'Bare Title',
      author: 'Kept Author',
      publisher: null,
      year: null,
      description: null,
      copies: 0,
      out: 0,
      holds: 0,
      last_refreshed_at: now.toISOString(),
    });
    expect(tags('101')).toEqual([]);
    expect(fts('101')).toEqual({
      title: 'Bare Title',
      author: 'Kept Author',
      description: '',
    });
  });

  it('is idempotent when re-run over the same sample', async () => {
    setSample(['100']);
    insertBook('100', 'Old Title');
    const now = new Date('2026-11-10T12:00:00.000Z');
    const refreshed = detail({
      joinId: '100',
      title: 'New Title',
      author: 'New Author',
      publisher: 'A Publisher',
      year: 2001,
      description: 'A description.',
      copies: 2,
      out: 1,
      holds: 0,
      tags: ['fiction', 'classics', 'fiction'],
    });
    const deps = {
      fetchDetail: async () => refreshed,
      now: () => now,
      delayMs: 0,
    };

    await refreshBookDetails(db, deps);
    const firstBook = book('100');
    const firstTags = tags('100');
    const firstFts = fts('100');

    const result = await refreshBookDetails(db, deps);

    expect(result).toEqual({ sampleSize: 1, refreshed: 1, skipped: 0 });
    expect(book('100')).toEqual(firstBook);
    expect(tags('100')).toEqual(firstTags);
    expect(tags('100')).toEqual(['classics', 'fiction']);
    expect(fts('100')).toEqual(firstFts);
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM books_fts WHERE join_id = ?').get('100'),
    ).toEqual({ count: 1 });
  });

  it('skips missing samples and records returned without detail', async () => {
    const calls: string[] = [];
    const missingSample = await refreshBookDetails(db, {
      fetchDetail: async (joinId) => {
        calls.push(joinId);
        return detail({ joinId });
      },
    });

    expect(missingSample).toEqual({ sampleSize: 0, refreshed: 0, skipped: 0 });
    expect(calls).toEqual([]);

    setSample(['100', '101']);
    insertBook('100', 'Present');
    insertBook('101', 'Missing');

    const result = await refreshBookDetails(db, {
      fetchDetail: async (joinId) => {
        calls.push(joinId);
        return joinId === '100' ? detail({ joinId, title: 'Present' }) : null;
      },
      now: () => new Date('2026-11-10T12:00:00.000Z'),
      delayMs: 0,
    });

    expect(result).toEqual({ sampleSize: 2, refreshed: 1, skipped: 1 });
    expect(calls).toEqual(['100', '101']);
    expect(book('100').last_refreshed_at).toBe('2026-11-10T12:00:00.000Z');
    expect(book('101').last_refreshed_at).toBeNull();
  });

  it('paces requests with the configured delay', async () => {
    setSample(['100', '101', '102']);
    for (const joinId of ['100', '101', '102']) insertBook(joinId, joinId);
    const sleeps: number[] = [];

    await refreshBookDetails(db, {
      fetchDetail: async (joinId) => detail({ joinId, title: joinId }),
      now: () => new Date('2026-11-10T12:00:00.000Z'),
      delayMs: 250,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(sleeps).toEqual([250, 250]);
  });

  it('stops and propagates Libib refusal errors', async () => {
    setSample(['100', '101']);
    insertBook('100', 'First');
    insertBook('101', 'Second');
    const calls: string[] = [];

    const error = await refreshBookDetails(db, {
      fetchDetail: async (joinId) => {
        calls.push(joinId);
        throw new LibibRequestError(429, 'Libib refused rate');
      },
      delayMs: 0,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LibibRequestError);
    expect(calls).toEqual(['100']);
    expect(book('100').last_refreshed_at).toBeNull();
  });
});
