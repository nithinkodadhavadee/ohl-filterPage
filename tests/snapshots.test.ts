import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdapterRegistry } from '../src/server/adapters.js';
import {
  scanCatalogue,
  type CatalogueScanDeps,
} from '../src/server/catalogue-scan.js';
import { loadConfig, type AppConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { runEnrichCli } from '../src/server/enrich-cli.js';
import {
  EnrichmentAdapterRegistry,
  type EnrichmentAdapter,
} from '../src/server/enrichment.js';
import type { LibibIndexItem } from '../src/server/libib-index.js';
import { runOverrideImportCli } from '../src/server/override-cli.js';
import {
  serverLockPath,
  acquireServerLock,
  releaseServerLock,
} from '../src/server/server-lock.js';
import {
  listSnapshots,
  restoreSnapshot,
  snapshotFileName,
  takeSnapshot,
} from '../src/server/snapshot.js';
import { runExportCommand } from '../src/server/snapshot-cli.js';

describe('snapshots, restore and export', () => {
  let dataDir: string;
  let config: AppConfig;
  let db: DatabaseSync;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-snapshot-'));
    config = loadConfig({ dataDir });
    db = openDatabase(config);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // Some tests close the database before restoring.
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  function insertBook(
    joinId: string,
    title: string,
    overrides: {
      author?: string | null;
      hidden?: number;
      coverPath?: string | null;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO book_records (
         join_id, title, author, cover_path, copies, out, holds,
         first_seen_at, last_refreshed_at, hidden
       ) VALUES (?, ?, ?, ?, 2, 1, 3,
         '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', ?)`,
    ).run(
      joinId,
      title,
      overrides.author ?? 'An Author',
      overrides.coverPath ?? null,
      overrides.hidden ?? 0,
    );
  }

  function insertEnrichment(joinId: string): void {
    db.prepare(
      `INSERT INTO enrichment (
         join_id, source, source_id, matched_title, matched_author,
         rating_average, rating_count, page_count, status, enriched_at
       ) VALUES (?, 'openlibrary', '/works/OL1W', 'Matched', 'Matched Author',
         4.5, 12, 310, 'enriched', '2026-11-03T00:00:00.000Z')`,
    ).run(joinId);
  }

  function insertOverride(joinId: string): void {
    db.prepare(
      `INSERT INTO match_overrides (join_id, source, source_id, note, created_at)
       VALUES (?, 'openlibrary', '/works/OL1W', 'Pinned', '2026-11-04T00:00:00.000Z')`,
    ).run(joinId);
  }

  function openSnapshot(snapshot: string): DatabaseSync {
    return new DatabaseSync(snapshot, { readOnly: true });
  }

  function item(joinId: string, title: string): LibibIndexItem {
    return { joinId, title, author: 'An Author', coverUrl: null };
  }

  it('takes a consistent snapshot containing the catalogue data', () => {
    mkdirSync(config.coversDir, { recursive: true });
    writeFileSync(path.join(config.coversDir, 'cover.jpg'), 'cached cover');
    insertBook('book-1', 'The Hobbit', { hidden: 1 });

    const snapshot = takeSnapshot(db, config, {
      now: () => new Date('2026-11-10T12:00:00.000Z'),
    });

    expect(snapshot).toBe(
      path.join(
        config.snapshotsDir,
        snapshotFileName(new Date('2026-11-10T12:00:00.000Z')),
      ),
    );
    expect(path.basename(snapshot)).toBe(
      'catalogue-2026-11-10T12-00-00-000Z.sqlite',
    );
    expect(readdirSync(config.snapshotsDir)).toEqual([path.basename(snapshot)]);

    const copy = openSnapshot(snapshot);
    try {
      const row = copy
        .prepare('SELECT title, hidden, copies FROM book_records WHERE join_id = ?')
        .get('book-1') as Record<string, unknown>;
      expect(row).toMatchObject({ title: 'The Hobbit', hidden: 1, copies: 2 });
    } finally {
      copy.close();
    }
  });

  it('prunes the oldest snapshots beyond the retain count', () => {
    const times = [
      '2026-11-10T12:00:00.000Z',
      '2026-11-10T12:01:00.000Z',
      '2026-11-10T12:02:00.000Z',
      '2026-11-10T12:03:00.000Z',
      '2026-11-10T12:04:00.000Z',
    ];

    for (const time of times) {
      takeSnapshot(db, config, {
        retain: 3,
        now: () => new Date(time),
      });
    }

    const remaining = listSnapshots(config).map((entry) => path.basename(entry));
    expect(remaining).toEqual(
      times.slice(2).map((time) => snapshotFileName(new Date(time))),
    );
  });

  it('restores book records, hidden flags, enrichments and overrides', () => {
    insertBook('book-1', 'The Hobbit', { hidden: 1, coverPath: 'cover-1.jpg' });
    db.prepare(
      `INSERT INTO book_tags (join_id, tag) VALUES ('book-1', 'fiction')`,
    ).run();
    db.prepare(
      `INSERT INTO book_subjects (join_id, subject) VALUES ('book-1', 'Fantasy')`,
    ).run();
    insertEnrichment('book-1');
    insertOverride('book-1');

    const snapshot = takeSnapshot(db, config, {
      now: () => new Date('2026-11-10T12:00:00.000Z'),
    });

    db.prepare("UPDATE book_records SET title = 'Changed', hidden = 0").run();
    db.prepare('DELETE FROM enrichment').run();
    db.prepare('DELETE FROM match_overrides').run();
    insertBook('book-2', 'Added after the snapshot');

    db.close();
    restoreSnapshot(config, snapshot);
    db = openDatabase(config);

    const book = db
      .prepare('SELECT title, hidden, cover_path FROM book_records WHERE join_id = ?')
      .get('book-1') as Record<string, unknown>;
    expect(book).toMatchObject({
      title: 'The Hobbit',
      hidden: 1,
      cover_path: 'cover-1.jpg',
    });
    expect(
      db.prepare('SELECT 1 AS found FROM book_records WHERE join_id = ?').get('book-2'),
    ).toBeUndefined();
    expect(
      db.prepare('SELECT tag FROM book_tags WHERE join_id = ?').get('book-1'),
    ).toMatchObject({ tag: 'fiction' });
    expect(
      db.prepare('SELECT subject FROM book_subjects WHERE join_id = ?').get('book-1'),
    ).toMatchObject({ subject: 'Fantasy' });
    expect(
      db.prepare('SELECT * FROM enrichment WHERE join_id = ?').get('book-1'),
    ).toMatchObject({
      source_id: '/works/OL1W',
      rating_average: 4.5,
      rating_count: 12,
      page_count: 310,
      status: 'enriched',
    });
    expect(
      db.prepare('SELECT * FROM match_overrides WHERE join_id = ?').get('book-1'),
    ).toMatchObject({
      source: 'openlibrary',
      source_id: '/works/OL1W',
      note: 'Pinned',
    });
  });

  it('refuses to restore against a fresh heartbeat but proceeds with a stale one', () => {
    insertBook('book-1', 'Original');
    const snapshot = takeSnapshot(db, config, {
      now: () => new Date('2026-11-10T12:00:00.000Z'),
    });
    db.prepare("UPDATE book_records SET title = 'Changed'").run();
    db.close();

    acquireServerLock(config);
    expect(() => restoreSnapshot(config, snapshot)).toThrow(
      /server is running/,
    );
    releaseServerLock(config);

    writeFileSync(
      serverLockPath(config),
      JSON.stringify({ pid: 999_999, heartbeatAt: new Date().toISOString() }),
      'utf8',
    );
    expect(() => restoreSnapshot(config, snapshot)).toThrow(
      /server is running/,
    );

    writeFileSync(
      serverLockPath(config),
      JSON.stringify({
        pid: process.pid,
        heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      'utf8',
    );

    expect(() => restoreSnapshot(config, snapshot)).not.toThrow();
    expect(existsSync(serverLockPath(config))).toBe(false);

    db = openDatabase(config);
    const row = db
      .prepare('SELECT title FROM book_records WHERE join_id = ?')
      .get('book-1') as { title: string };
    expect(row.title).toBe('Original');
  });

  it('refuses a second start while the heartbeat is fresh', () => {
    acquireServerLock(config, 111);
    try {
      expect(() => acquireServerLock(config, 222)).toThrow(
        /already running/,
      );
    } finally {
      releaseServerLock(config, 111);
    }

    writeFileSync(
      serverLockPath(config),
      JSON.stringify({
        pid: 111,
        heartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      }),
      'utf8',
    );
    expect(() => acquireServerLock(config, 222)).not.toThrow();
    releaseServerLock(config, 222);
  });

  it('exports a snapshot to a chosen path', () => {
    insertBook('book-1', 'The Hobbit');
    const destination = path.join(dataDir, 'off-host', 'catalogue.sqlite');
    const logs: string[] = [];

    const exitCode = runExportCommand([destination], config, {
      db,
      now: () => new Date('2026-11-10T12:00:00.000Z'),
      log: (line) => logs.push(line),
      error: () => {},
    });

    expect(exitCode).toBe(0);
    expect(existsSync(destination)).toBe(true);
    expect(logs[0]).toMatch(/Exported snapshot/);

    const copy = openSnapshot(destination);
    try {
      const row = copy
        .prepare('SELECT title FROM book_records WHERE join_id = ?')
        .get('book-1') as { title: string };
      expect(row.title).toBe('The Hobbit');
    } finally {
      copy.close();
    }
  });

  it('exports a chosen existing snapshot without taking a fresh one', () => {
    insertBook('book-1', 'The Hobbit');
    const existing = takeSnapshot(db, config, {
      now: () => new Date('2026-11-10T12:00:00.000Z'),
    });
    db.prepare("UPDATE book_records SET title = 'Changed'").run();
    const destination = path.join(dataDir, 'off-host', 'chosen.sqlite');

    const exitCode = runExportCommand([existing, destination], config, {
      db,
      now: () => new Date('2026-11-10T13:00:00.000Z'),
      log: () => {},
      error: () => {},
    });

    expect(exitCode).toBe(0);
    expect(listSnapshots(config)).toHaveLength(1);

    const copy = openSnapshot(destination);
    try {
      const row = copy
        .prepare('SELECT title FROM book_records WHERE join_id = ?')
        .get('book-1') as { title: string };
      expect(row.title).toBe('The Hobbit');
    } finally {
      copy.close();
    }
  });

  it('fires the catalogue scan, full enrichment and override import hooks', async () => {
    let scanned = 0;
    const indexDeps: CatalogueScanDeps = {
      fetchIndex: async () => [item('book-1', 'The Hobbit')],
      sampleSize: 0,
      onComplete: (result) => {
        expect(result).toMatchObject({ mode: 'scan', added: 1 });
        scanned += 1;
      },
    };
    await scanCatalogue(db, indexDeps);
    expect(scanned).toBe(1);

    const adapter: EnrichmentAdapter = {
      source: 'fake',
      async search() {
        return [];
      },
      async fetch() {
        return {
          ratingAverage: null,
          ratingCount: 0,
          pageCount: null,
          subjects: [],
        };
      },
    };
    let enriched = 0;
    await runEnrichCli(['--all'], {
      db,
      adapters: new EnrichmentAdapterRegistry([adapter]),
      sleep: async () => {},
      onComplete: () => {
        enriched += 1;
      },
    });
    expect(enriched).toBe(1);

    const csvPath = path.join(dataDir, 'overrides.csv');
    writeFileSync(
      csvPath,
      [
        'join_id,source,source_id_or_url,note',
        'book-1,openlibrary,OL1168083W,pin',
        '',
      ].join('\n'),
      'utf8',
    );
    let imported = 0;
    runOverrideImportCli([csvPath], {
      db,
      adapters: createAdapterRegistry(),
      onImported: (result) => {
        expect(result).toMatchObject({ imported: 1, updated: 0 });
        imported += 1;
      },
    });
    expect(imported).toBe(1);
  });
});
