import type { DatabaseSync } from 'node:sqlite';
import {
  enrichOnFirstSight,
  type EnrichmentAdapterRegistry,
} from './enrichment.js';
import type { LibibIndexItem } from './libib-index.js';
import { selectSample } from './sample.js';

export interface CatalogueIndexDeps {
  fetchIndex: () => Promise<LibibIndexItem[]>;
  cacheCover?: (item: LibibIndexItem) => Promise<string | null>;
  adapters?: EnrichmentAdapterRegistry;
  enrichDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: (message: string) => void;
  now?: () => Date;
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface CatalogueIndexResult {
  mode: 'index' | 'resample';
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
}

interface PreparedItem {
  item: LibibIndexItem;
  coverPath: string | null;
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

async function persistSample(
  db: DatabaseSync,
  target: readonly LibibIndexItem[],
  deps: CatalogueIndexDeps,
  mode: CatalogueIndexResult['mode'],
): Promise<CatalogueIndexResult> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const uniqueTarget = dedupeById(target);

  const existing = new Map<string, ExistingRecord>();
  const existingRows = db
    .prepare('SELECT join_id, description, cover_path, first_seen_at FROM book_records')
    .all() as unknown as ExistingRecord[];
  for (const record of existingRows) existing.set(record.join_id, record);

  const prepared: PreparedItem[] = [];
  for (const item of uniqueTarget) {
    const previous = existing.get(item.joinId);
    const coverPath = deps.cacheCover
      ? await deps.cacheCover(item)
      : (previous?.cover_path ?? null);
    prepared.push({ item, coverPath });
  }

  const targetIds = new Set(uniqueTarget.map((item) => item.joinId));
  const removedIds = [...existing.keys()].filter((joinId) => !targetIds.has(joinId));

  const upsertBook = db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, publisher, year, description, cover_path,
      copies, out, holds, first_seen_at, last_refreshed_at
    ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, 0, 0, 0, ?, NULL)
    ON CONFLICT(join_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      cover_path = excluded.cover_path
  `);
  const deleteFts = db.prepare('DELETE FROM books_fts WHERE join_id = ?');
  const insertFts = db.prepare(`
    INSERT INTO books_fts (join_id, title, author, description)
    VALUES (?, ?, ?, ?)
  `);
  const deleteBook = db.prepare('DELETE FROM book_records WHERE join_id = ?');

  let added = 0;
  let updated = 0;
  const addedIds: string[] = [];

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const { item, coverPath } of prepared) {
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
        coverPath,
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

    for (const joinId of removedIds) {
      deleteFts.run(joinId);
      deleteBook.run(joinId);
    }

    writeState(db, SAMPLE_KEY, JSON.stringify(uniqueTarget.map((item) => item.joinId)));
    writeState(db, LAST_REFRESHED_KEY, now);

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
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
          `Could not enrich new book record ${joinId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  return {
    mode,
    sampleSize: prepared.length,
    added,
    updated,
    removed: removedIds.length,
  };
}

export async function refreshCatalogueIndex(
  db: DatabaseSync,
  deps: CatalogueIndexDeps,
): Promise<CatalogueIndexResult> {
  const index = dedupeById(await deps.fetchIndex());
  const sampledIds = readSampleIds(db);

  let target: LibibIndexItem[];
  if (sampledIds !== null) {
    const byId = new Map(index.map((item) => [item.joinId, item]));
    target = sampledIds
      .map((joinId) => byId.get(joinId))
      .filter((item): item is LibibIndexItem => item !== undefined);
  } else {
    target = selectSample(index);
  }

  return persistSample(db, target, deps, 'index');
}

export async function resampleCatalogueIndex(
  db: DatabaseSync,
  deps: CatalogueIndexDeps,
): Promise<CatalogueIndexResult> {
  const index = dedupeById(await deps.fetchIndex());
  return persistSample(db, selectSample(index), deps, 'resample');
}
