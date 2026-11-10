import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from './config.js';
import {
  clearStaleServerLock,
  isServerRunning,
  readServerLockPid,
} from './server-lock.js';
import { errorMessage } from './util.js';

export const SNAPSHOT_PREFIX = 'catalogue-';
export const SNAPSHOT_EXTENSION = '.sqlite';

export interface TakeSnapshotOptions {
  retain?: number;
  now?: () => Date;
}

export function snapshotFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${SNAPSHOT_PREFIX}${stamp}${SNAPSHOT_EXTENSION}`;
}

function snapshotPathFor(config: AppConfig, name: string): string {
  return path.join(config.snapshotsDir, name);
}

function snapshotSortKey(filePath: string): string {
  return path.basename(filePath, SNAPSHOT_EXTENSION);
}

export function listSnapshots(config: AppConfig): string[] {
  let names: string[];
  try {
    names = readdirSync(config.snapshotsDir);
  } catch {
    return [];
  }

  return names
    .filter(
      (name) =>
        name.startsWith(SNAPSHOT_PREFIX) && name.endsWith(SNAPSHOT_EXTENSION),
    )
    .map((name) => snapshotPathFor(config, name))
    .sort((left, right) =>
      snapshotSortKey(left).localeCompare(snapshotSortKey(right)),
    );
}

export function pruneSnapshots(
  config: AppConfig,
  retain: number = config.snapshotRetain,
): string[] {
  const keep = Math.max(0, Math.trunc(retain));
  const snapshots = listSnapshots(config);
  const excess = snapshots.slice(0, Math.max(0, snapshots.length - keep));

  for (const snapshot of excess) {
    rmSync(snapshot, { force: true });
  }

  return excess;
}

function uniqueSnapshotPath(config: AppConfig, name: string): string {
  const base = name.slice(0, -SNAPSHOT_EXTENSION.length);
  let candidate = snapshotPathFor(config, name);
  let counter = 1;

  while (existsSync(candidate)) {
    candidate = snapshotPathFor(
      config,
      `${base}-${counter}${SNAPSHOT_EXTENSION}`,
    );
    counter += 1;
  }

  return candidate;
}

export function takeSnapshot(
  db: DatabaseSync,
  config: AppConfig,
  options: TakeSnapshotOptions = {},
): string {
  mkdirSync(config.snapshotsDir, { recursive: true });

  const now = options.now?.() ?? new Date();
  const target = uniqueSnapshotPath(config, snapshotFileName(now));

  try {
    db.prepare('VACUUM INTO ?').run(target);
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  }

  pruneSnapshots(config, options.retain ?? config.snapshotRetain);
  return target;
}

export function takeSnapshotSafely(
  db: DatabaseSync,
  config: AppConfig,
  options: TakeSnapshotOptions & { log?: (message: string) => void } = {},
): string | null {
  try {
    const snapshot = takeSnapshot(db, config, options);
    options.log?.(`Snapshot written to ${snapshot}.`);
    return snapshot;
  } catch (error) {
    options.log?.(`Could not take snapshot: ${errorMessage(error)}`);
    return null;
  }
}

export function snapshotOnSuccess(
  db: DatabaseSync,
  config: AppConfig,
  log?: (message: string) => void,
): () => void {
  return () => {
    takeSnapshotSafely(db, config, { log });
  };
}

export function exportSnapshot(source: string, destination: string): void {
  if (!existsSync(source)) {
    throw new Error(`Snapshot not found: ${source}`);
  }

  const resolved = path.resolve(destination);
  mkdirSync(path.dirname(resolved), { recursive: true });
  copyFileSync(source, resolved);
}

export function restoreSnapshot(
  config: AppConfig,
  snapshotPath: string,
): void {
  const source = path.resolve(snapshotPath);
  if (!existsSync(source)) {
    throw new Error(`Snapshot not found: ${source}`);
  }

  if (isServerRunning(config)) {
    const pid = readServerLockPid(config);
    throw new Error(
      `Refusing to restore: the server is running (PID ${pid ?? 'unknown'}). ` +
        'Stop the server, restore, then start it again.',
    );
  }
  clearStaleServerLock(config);

  mkdirSync(config.dataDir, { recursive: true });
  const temporary = `${config.dbPath}.restore-${process.pid}.tmp`;
  copyFileSync(source, temporary);

  for (const suffix of ['-wal', '-shm', '']) {
    try {
      unlinkSync(`${config.dbPath}${suffix}`);
    } catch {
      // The file may not exist.
    }
  }

  renameSync(temporary, config.dbPath);
}
