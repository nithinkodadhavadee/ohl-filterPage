import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  scanCatalogue,
  resampleCatalogue,
  type CatalogueScanDeps,
} from '../src/server/catalogue-scan.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import type { LibibIndexItem } from '../src/server/libib-index.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-index-'));
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
  coverUrl: string | null = null,
): LibibIndexItem {
  return { joinId, title, author, coverUrl };
}

function deps(
  index: LibibIndexItem[],
  now: Date,
  sampleSize = 50,
): CatalogueScanDeps {
  return {
    fetchIndex: async () => index,
    sampleSize,
    cacheCover: async (entry) =>
      entry.coverUrl ? `cover-${entry.joinId}.jpg` : null,
    now: () => now,
  };
}

interface BookRow {
  join_id: string;
  title: string;
  author: string | null;
  cover_path: string | null;
  first_seen_at: string;
  copies: number;
  out: number;
  holds: number;
  hidden: number;
}

function books(): BookRow[] {
  return db
    .prepare(
      `SELECT join_id, title, author, cover_path, first_seen_at, copies, out, holds, hidden
       FROM book_records ORDER BY join_id`,
    )
    .all() as unknown as BookRow[];
}

function state(key: string): string | null {
  const row = db
    .prepare('SELECT value FROM crawl_state WHERE key = ?')
    .get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

function ftsCount(): number {
  return (
    db.prepare('SELECT COUNT(*) AS count FROM books_fts').get() as {
      count: number;
    }
  ).count;
}

describe('scanCatalogue', () => {
  it('persists only sampled records and records the sample state', async () => {
    const now = new Date('2026-11-10T10:00:00.000Z');
    const index = [
      item('100', '1984'),
      item('101', 'The Absent Color: Poems', 'A. Poet', 'https://cdn/a.jpg'),
      item('102', 'Abundance', 'Peter H. Diamandis'),
    ];

    const result = await scanCatalogue(db, deps(index, now));

    expect(result).toEqual({
      mode: 'scan',
      sampleSize: 2,
      added: 2,
      updated: 0,
      removed: 0,
    });

    const stored = books();
    expect(stored.map((book) => book.join_id)).toEqual(['101', '102']);
    expect(stored.find((book) => book.join_id === '101')).toMatchObject({
      title: 'The Absent Color: Poems',
      author: 'A. Poet',
      cover_path: 'cover-101.jpg',
      first_seen_at: now.toISOString(),
      copies: 0,
      out: 0,
      holds: 0,
    });
    expect(stored.find((book) => book.join_id === '102')?.cover_path).toBeNull();
    expect(state('sample_join_ids')).toBe(JSON.stringify(['101', '102']));
    expect(state('last_index_refreshed_at')).toBe(now.toISOString());
    expect(ftsCount()).toBe(2);
  });

  it('replaces existing fixture records that are not in the sample', async () => {
    db.prepare(
      'INSERT INTO book_records (join_id, title, first_seen_at) VALUES (?, ?, ?)',
    ).run('900', 'Seed Fixture', '2026-11-01T00:00:00.000Z');
    db.prepare(
      'INSERT INTO books_fts (join_id, title, author, description) VALUES (?, ?, ?, ?)',
    ).run('900', 'Seed Fixture', '', '');

    const now = new Date('2026-11-10T10:00:00.000Z');
    const result = await scanCatalogue(
      db,
      deps([item('101', 'Abundance')], now),
    );

    expect(result).toEqual({
      mode: 'scan',
      sampleSize: 1,
      added: 1,
      updated: 0,
      removed: 1,
    });
    expect(books().map((book) => book.join_id)).toEqual(['101', '900']);
    expect(books().find((book) => book.join_id === '900')?.hidden).toBe(1);
    expect(ftsCount()).toBe(2);
  });

  it('refreshes sampled records, hides disappearances and adds nothing new', async () => {
    const firstNow = new Date('2026-11-10T10:00:00.000Z');
    await scanCatalogue(
      db,
      deps(
        [
          item('101', 'Abundance', 'First Author', 'https://cdn/one.jpg'),
          item('102', 'Beloved', 'Second Author'),
        ],
        firstNow,
      ),
    );
    const firstSeen = books().find((book) => book.join_id === '101')
      ?.first_seen_at;

    const secondNow = new Date('2026-11-10T11:00:00.000Z');
    const result = await scanCatalogue(
      db,
      deps(
        [
          item('101', 'Abundance (Revised)', 'Second Author', 'https://cdn/two.jpg'),
          item('103', 'Aardvark', 'New Author'),
        ],
        secondNow,
      ),
    );

    expect(result).toEqual({
      mode: 'scan',
      sampleSize: 1,
      added: 0,
      updated: 1,
      removed: 1,
    });

    const stored = books();
    expect(stored.map((book) => book.join_id)).toEqual(['101', '102']);
    expect(stored[0]).toMatchObject({
      title: 'Abundance (Revised)',
      author: 'Second Author',
      cover_path: 'cover-101.jpg',
      first_seen_at: firstSeen,
      hidden: 0,
    });
    expect(stored[1]).toMatchObject({ join_id: '102', hidden: 1 });
    expect(state('sample_join_ids')).toBe(JSON.stringify(['101', '102']));
    expect(state('last_index_refreshed_at')).toBe(secondNow.toISOString());
    expect(ftsCount()).toBe(2);
  });
});

describe('resampleCatalogue', () => {
  it('re-picks the sample from the fresh index and reconciles stored records', async () => {
    const firstNow = new Date('2026-11-10T10:00:00.000Z');
    await scanCatalogue(
      db,
      deps([item('201', 'Aardvark'), item('202', 'Beloved')], firstNow),
    );
    const firstSeen = books().find((book) => book.join_id === '201')
      ?.first_seen_at;

    const secondNow = new Date('2026-11-10T11:00:00.000Z');
    const result = await resampleCatalogue(
      db,
      deps(
        [
          item('200', '1984'),
          item('203', 'Abundance', 'A. Author', 'https://cdn/a.jpg'),
          item('201', 'Aardvark (Revised)'),
          item('204', 'Zebra'),
        ],
        secondNow,
      ),
    );

    expect(result).toEqual({
      mode: 'resample',
      sampleSize: 3,
      added: 2,
      updated: 1,
      removed: 1,
    });

    const stored = books();
    expect(stored.map((book) => book.join_id).sort()).toEqual([
      '201',
      '202',
      '203',
      '204',
    ]);
    expect(stored.find((book) => book.join_id === '202')).toMatchObject({
      hidden: 1,
    });
    expect(stored.find((book) => book.join_id === '201')).toMatchObject({
      title: 'Aardvark (Revised)',
      first_seen_at: firstSeen,
    });
    expect(stored.find((book) => book.join_id === '203')).toMatchObject({
      title: 'Abundance',
      author: 'A. Author',
      cover_path: 'cover-203.jpg',
      first_seen_at: secondNow.toISOString(),
    });
    expect(state('sample_join_ids')).toBe(
      JSON.stringify(['203', '201', '204']),
    );
    expect(state('last_index_refreshed_at')).toBe(secondNow.toISOString());
    expect(ftsCount()).toBe(4);
  });

  it('keeps still-present records that a smaller Sample excludes', async () => {
    const firstNow = new Date('2026-11-10T10:00:00.000Z');
    await scanCatalogue(
      db,
      deps(
        [item('301', 'Abundance'), item('302', 'Beloved')],
        firstNow,
        0,
      ),
    );

    const secondNow = new Date('2026-11-10T11:00:00.000Z');
    const result = await resampleCatalogue(
      db,
      deps(
        [item('301', 'Abundance'), item('302', 'Beloved')],
        secondNow,
        1,
      ),
    );

    expect(result).toEqual({
      mode: 'resample',
      sampleSize: 1,
      added: 0,
      updated: 1,
      removed: 0,
    });

    const stored = books();
    expect(stored.map((book) => book.join_id).sort()).toEqual([
      '301',
      '302',
    ]);
    expect(stored.find((book) => book.join_id === '302')).toMatchObject({
      hidden: 0,
    });
    expect(state('sample_join_ids')).toBe(JSON.stringify(['301']));
  });
});
