import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AppConfig } from './config.js';
import { openDatabase } from './db.js';
import {
  exportSnapshot,
  restoreSnapshot,
  takeSnapshot,
  type TakeSnapshotOptions,
} from './snapshot.js';

const USAGE = 'Usage: snapshot-cli <snapshot|restore|export> [--] <path>';

function positional(args: readonly string[]): string[] {
  return args.filter((argument) => argument !== '--');
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface SnapshotCommandDeps {
  db: DatabaseSync;
  now?: TakeSnapshotOptions['now'];
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export function runSnapshotCommand(
  config: AppConfig,
  deps: SnapshotCommandDeps,
): number {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));

  try {
    const snapshot = takeSnapshot(deps.db, config, { now: deps.now });
    log(`Snapshot written to ${snapshot}.`);
    return 0;
  } catch (caught) {
    error(`Could not take snapshot: ${detail(caught)}`);
    return 1;
  }
}

export interface RestoreCommandDeps {
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export function runRestoreCommand(
  args: readonly string[],
  config: AppConfig,
  deps: RestoreCommandDeps = {},
): number {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));
  const paths = positional(args);

  if (paths.length !== 1) {
    error(USAGE);
    return 1;
  }

  try {
    restoreSnapshot(config, paths[0]);
    log(`Restored database from ${paths[0]}.`);
    return 0;
  } catch (caught) {
    error(detail(caught));
    return 1;
  }
}

export interface ExportCommandDeps extends SnapshotCommandDeps {}

export function runExportCommand(
  args: readonly string[],
  config: AppConfig,
  deps: ExportCommandDeps,
): number {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));
  const paths = positional(args);

  if (paths.length !== 1) {
    error(USAGE);
    return 1;
  }

  try {
    const snapshot = takeSnapshot(deps.db, config, { now: deps.now });
    const destination = paths[0];
    exportSnapshot(snapshot, destination);
    log(`Exported snapshot to ${destination}.`);
    return 0;
  } catch (caught) {
    error(`Could not export snapshot: ${detail(caught)}`);
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const [command, ...rest] = positional(process.argv.slice(2));

  if (command === 'restore') {
    process.exitCode = runRestoreCommand(rest, config);
  } else if (command === 'snapshot' || command === 'export') {
    const db = openDatabase(config);
    try {
      process.exitCode =
        command === 'snapshot'
          ? runSnapshotCommand(config, { db })
          : runExportCommand(rest, config, { db });
    } finally {
      db.close();
    }
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
}
