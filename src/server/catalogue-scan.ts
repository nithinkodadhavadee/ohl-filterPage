import type { DatabaseSync } from 'node:sqlite';
import {
  enrichOnFirstSight,
  type EnrichmentAdapterRegistry,
} from './enrichment.js';
import type { LibibIndexItem } from './libib-index.js';
import { withRun, type RunTrigger } from './run-log.js';
import { selectSample } from './sample.js';
import { errorMessage, sleep as defaultSleep } from './util.js';

export interface CatalogueScanDeps {
  fetchIndex: () => Promise<LibibIndexItem[]>;
  sampleSize?: number;
  cacheCover?: (item: LibibIndexItem) => Promise<string | null>;
  adapters?: EnrichmentAdapterRegistry;
  enrichDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: (message: string) => void;
  now?: () => Date;
  trigger?: RunTrigger;
  onComplete?: (result: CatalogueScanResult) => void | Promise<void>;
}

export interface CatalogueScanResult {
  mode: 'scan' | 'resample';
  sampleSize: number;
  added: number;
  updated: number;
  removed: number;
}

const SAMPLE_KEY = 'sample_join_ids';
const LAST_REFRESHED_KEY = 'last_index_refreshed_at';

interface ExistingRecord {
  join_id: string;
  description: string | null;
  cover_path: string | null;
  first_seen_at: string;
  hidden: number;
}

function readSampleIds(db: DatabaseSync): string[] | null {
  const statement = db.prepare('SELECT value FROM crawl_state WHERE key = ?');
  const result = statement.get(SAMPLE_KEY) as { value: string | null } | undefined;
  if (!result?.value) return null;

  try {
    const parsed: unknown = JSON.parse(result.value);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return null;
  }
}

function writeState(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO crawl_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function dedupeById(items: readonly LibibIndexItem[]): LibibIndexItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.joinId)) return false;
    seen.add(item.joinId);
    return true;
  });
}

async function persistCatalogueScan(
  db: DatabaseSync,
  fullIndex: readonly LibibIndexItem[],
  target: readonly LibibIndexItem[],
  deps: CatalogueScanDeps,
  mode: CatalogueScanResult['mode'],
  sampleIds: readonly string[],
): Promise<CatalogueScanResult> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const uniqueTarget = dedupeById(target);
  const indexIds = new Set(fullIndex.map((item) => item.joinId));

  const existing = new Map<string, ExistingRecord>();
  const existingRows = db
    .prepare(
      'SELECT join_id, description, cover_path, first_seen_at, hidden FROM book_records',
    )
    .all() as unknown as ExistingRecord[];
  for (const record of existingRows) existing.set(record.join_id, record);

  const targetIds = new Set(uniqueTarget.map((item) => item.joinId));
  const vanishedIds = [...existing.keys()].filter(
    (joinId) => !indexIds.has(joinId),
  );
  const removedIds = vanishedIds.filter(
    (joinId) => existing.get(joinId)?.hidden === 0,
  );
  const returningIds = [...existing.keys()].filter(
    (joinId) =>
      indexIds.has(joinId) &&
      !targetIds.has(joinId) &&
      existing.get(joinId)?.hidden === 1,
  );

  const upsertBook = db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, publisher, year, description, cover_path,
      copies, out, holds, first_seen_at, last_refreshed_at, hidden
    ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, 0, 0, 0, ?, NULL, 0)
    ON CONFLICT(join_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      cover_path = excluded.cover_path,
      hidden = 0
  `);
  const deleteFts = db.prepare('DELETE FROM books_fts WHERE join_id = ?');
  const insertFts = db.prepare(`
    INSERT INTO books_fts (join_id, title, author, description)
    VALUES (?, ?, ?, ?)
  `);
  const hideBook = db.prepare(
    'UPDATE book_records SET hidden = 1 WHERE join_id = ?',
  );
  const unhideBook = db.prepare(
    'UPDATE book_records SET hidden = 0 WHERE join_id = ?',
  );
  const updateCover = db.prepare(
    'UPDATE book_records SET cover_path = ? WHERE join_id = ?',
  );

  let added = 0;
  let updated = 0;
  const addedIds: string[] = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const item of uniqueTarget) {
      const previous = existing.get(item.joinId);
      if (previous) {
        updated += 1;
      } else {
        added += 1;
        addedIds.push(item.joinId);
      }

      upsertBook.run(
        item.joinId,
        item.title,
        item.author,
        previous?.cover_path ?? null,
        previous?.first_seen_at ?? now,
      );

      deleteFts.run(item.joinId);
      insertFts.run(
        item.joinId,
        item.title,
        item.author ?? '',
        previous?.description ?? '',
      );
    }

    for (const joinId of returningIds) {
      unhideBook.run(joinId);
    }

    for (const joinId of vanishedIds) {
      hideBook.run(joinId);
    }

    writeState(db, SAMPLE_KEY, JSON.stringify(sampleIds));
    writeState(db, LAST_REFRESHED_KEY, now);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  if (deps.cacheCover) {
    for (const item of uniqueTarget) {
      let coverPath: string | null = null;
      try {
        coverPath = await deps.cacheCover(item);
        if (!coverPath && item.coverUrl) {
          deps.logger?.(
            `Could not cache cover for book record ${item.joinId}.`,
          );
        }
      } catch (error) {
        deps.logger?.(
          `Could not cache cover for book record ${item.joinId}: ${errorMessage(error)}`,
        );
      }

      db.exec('BEGIN IMMEDIATE');
      try {
        updateCover.run(coverPath, item.joinId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  if (addedIds.length > 0 && deps.adapters && deps.adapters.size > 0) {
    const delayMs = deps.enrichDelayMs ?? 0;
    const sleep = deps.sleep ?? defaultSleep;

    for (let index = 0; index < addedIds.length; index += 1) {
      if (index > 0 && delayMs > 0) await sleep(delayMs);

      const joinId = addedIds[index];
      try {
        const outcome = await enrichOnFirstSight(
          db,
          deps.adapters,
          joinId,
          { now: deps.now },
        );
        if (outcome?.status === 'failed') {
          deps.logger?.(
            `Could not enrich new book record ${joinId}: ${outcome.error}`,
          );
        }
      } catch (error) {
        deps.logger?.(
          `Could not enrich new book record ${joinId}: ${errorMessage(error)}`,
        );
      }
    }
  }

  const result: CatalogueScanResult = {
    mode,
    sampleSize: uniqueTarget.length,
    added,
    updated,
    removed: removedIds.length,
  };
  await deps.onComplete?.(result);
  return result;
}

function countsFor(result: CatalogueScanResult): Record<string, number> {
  return {
    sampleSize: result.sampleSize,
    added: result.added,
    updated: result.updated,
    removed: result.removed,
  };
}

async function scanCatalogueRun(
  db: DatabaseSync,
  deps: CatalogueScanDeps,
): Promise<CatalogueScanResult> {
  const index = dedupeById(await deps.fetchIndex());
  const sampledIds = readSampleIds(db);
  const sampleSize = deps.sampleSize ?? 0;

  let target: LibibIndexItem[];
  let nextSampleIds: string[];

  if (sampleSize <= 0) {
    target = index;
    nextSampleIds = index.map((item) => item.joinId);
  } else if (sampledIds !== null) {
    const byId = new Map(index.map((item) => [item.joinId, item]));
    target = sampledIds
      .map((joinId) => byId.get(joinId))
      .filter((item): item is LibibIndexItem => item !== undefined);
    nextSampleIds = sampledIds;
  } else {
    target = selectSample(index, sampleSize);
    nextSampleIds = target.map((item) => item.joinId);
  }

  return persistCatalogueScan(db, index, target, deps, 'scan', nextSampleIds);
}

export async function scanCatalogue(
  db: DatabaseSync,
  deps: CatalogueScanDeps,
): Promise<CatalogueScanResult> {
  return withRun(
    db,
    {
      kind: 'catalogue_scan',
      trigger: deps.trigger ?? 'automatic',
      note: 'scan',
      startedAt: deps.now?.() ?? new Date(),
    },
    () => scanCatalogueRun(db, deps),
    (result) => ({ status: 'ok', counts: countsFor(result) }),
  );
}

async function resampleCatalogueRun(
  db: DatabaseSync,
  deps: CatalogueScanDeps,
): Promise<CatalogueScanResult> {
  const index = dedupeById(await deps.fetchIndex());
  const target = selectSample(index, deps.sampleSize ?? 0);
  return persistCatalogueScan(
    db,
    index,
    target,
    deps,
    'resample',
    target.map((item) => item.joinId),
  );
}

export async function resampleCatalogue(
  db: DatabaseSync,
  deps: CatalogueScanDeps,
): Promise<CatalogueScanResult> {
  return withRun(
    db,
    {
      kind: 'catalogue_scan',
      trigger: deps.trigger ?? 'automatic',
      note: 'resample',
      startedAt: deps.now?.() ?? new Date(),
    },
    () => resampleCatalogueRun(db, deps),
    (result) => ({ status: 'ok', counts: countsFor(result) }),
  );
}
