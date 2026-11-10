import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { refreshBookDetails, type BookRefreshResult } from './circulation.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createLibibAdapter } from './libib.js';
import type { LibibDetail } from './libib-detail.js';

const USAGE = 'Usage: npm run sweep [-- --book <joinId>] [--delay <ms>]';

export interface SweepArgs {
  book: string | null;
  delayMs: number | null;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--') || !value.trim()) {
    throw new Error(`${flag} requires a value. ${USAGE}`);
  }
  return value.trim();
}

function parseDelay(value: string | undefined): number {
  const raw = requireValue('--delay', value);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--delay requires a whole number of milliseconds. ${USAGE}`);
  }
  return Number.parseInt(raw, 10);
}

export function parseSweepArgs(argv: readonly string[]): SweepArgs {
  let book: string | null = null;
  let delayMs: number | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--book') {
      book = requireValue('--book', argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith('--book=')) {
      book = requireValue('--book', argument.slice('--book='.length));
      continue;
    }
    if (argument === '--delay') {
      delayMs = parseDelay(argv[index + 1]);
      index += 1;
      continue;
    }
    if (argument.startsWith('--delay=')) {
      delayMs = parseDelay(argument.slice('--delay='.length));
      continue;
    }

    throw new Error(`Unknown argument "${argument}". ${USAGE}`);
  }

  return { book, delayMs };
}

export interface SweepCliDeps {
  db: DatabaseSync;
  fetchDetail: (joinId: string) => Promise<LibibDetail | null>;
  defaultDelayMs: number;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface SweepCliResult {
  exitCode: number;
  result?: BookRefreshResult;
}

function isVisibleBook(db: DatabaseSync, joinId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM book_records WHERE join_id = ? AND hidden = 0')
    .get(joinId);
  return row !== undefined;
}

export async function runSweepCli(
  argv: readonly string[],
  deps: SweepCliDeps,
): Promise<SweepCliResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));

  let args: SweepArgs;
  try {
    args = parseSweepArgs(argv);
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught));
    return { exitCode: 1 };
  }

  if (args.book !== null && !isVisibleBook(deps.db, args.book)) {
    error(`Book record ${args.book} is not in the catalogue.`);
    return { exitCode: 1 };
  }

  const delayMs = args.delayMs ?? deps.defaultDelayMs;

  try {
    const result = await refreshBookDetails(deps.db, {
      fetchDetail: deps.fetchDetail,
      now: deps.now,
      delayMs,
      sleep: deps.sleep,
      joinIds: args.book !== null ? [args.book] : undefined,
    });

    if (args.book !== null) {
      if (result.refreshed === 0) {
        log(`Libib returned no detail for book record ${args.book}; skipped.`);
      } else {
        log(`Swept book record ${args.book}.`);
      }
      return { exitCode: 0, result };
    }

    if (result.sampleSize === 0) {
      log('No book records to sweep. Run `npm run catalogue:scan` first.');
    } else {
      const skipped =
        result.skipped > 0
          ? `; ${result.skipped} skipped because Libib returned no detail`
          : '';
      log(
        `Swept circulation for ${result.refreshed} of ${result.sampleSize} ` +
          `book record(s)${skipped}.`,
      );
    }

    return { exitCode: 0, result };
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : String(caught);
    error(`Could not sweep book circulation: ${detail}`);
    return { exitCode: 1 };
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  const libib = createLibibAdapter({
    baseUrl: process.env.LIBIB_BASE_URL,
  });

  try {
    const result = await runSweepCli(process.argv.slice(2), {
      db,
      fetchDetail: (joinId) => libib.fetchDetail(joinId),
      defaultDelayMs: config.crawlerCycleDelayMs,
    });
    process.exitCode = result.exitCode;
  } finally {
    db.close();
  }
}
