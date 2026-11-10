import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createAdapterRegistry } from './adapters.js';
import { loadConfig } from './config.js';
import { getSampleJoinIds } from './circulation.js';
import { openDatabase } from './db.js';
import { parseDelayMs } from './delay.js';
import {
  DEFAULT_ENRICH_DELAY_MS,
  enrichBook,
  EnrichmentAdapterRegistry,
  type EnrichmentAdapter,
  type EnrichmentOutcome,
} from './enrichment.js';

export interface EnrichCliDeps {
  db: DatabaseSync;
  adapter?: EnrichmentAdapter;
  adapters?: EnrichmentAdapterRegistry;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export type EnrichSelection =
  | { kind: 'id'; joinId: string }
  | { kind: 'all' }
  | { kind: 'unmatched' }
  | { kind: 'failed' };

export interface EnrichSummary {
  enriched: number;
  unmatched: number;
  failed: number;
}

export interface EnrichCliResult {
  exitCode: number;
  outcome?: EnrichmentOutcome;
  summary?: EnrichSummary;
  outcomes?: EnrichmentOutcome[];
}

const USAGE =
  'Usage: npm run enrich -- --id <joinId> | --all | --unmatched | --failed';

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export function parseEnrichArgs(argv: readonly string[]): EnrichSelection {
  let selection: EnrichSelection | null = null;

  const choose = (next: EnrichSelection): void => {
    if (selection !== null) {
      throw new Error(`Choose exactly one refresh target. ${USAGE}`);
    }
    selection = next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--all') {
      choose({ kind: 'all' });
      continue;
    }
    if (argument === '--unmatched') {
      choose({ kind: 'unmatched' });
      continue;
    }
    if (argument === '--failed') {
      choose({ kind: 'failed' });
      continue;
    }
    if (argument === '--id') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--') || !value.trim()) {
        throw new Error(`--id requires a join id. ${USAGE}`);
      }
      choose({ kind: 'id', joinId: value.trim() });
      index += 1;
      continue;
    }
    if (argument.startsWith('--id=')) {
      const value = argument.slice('--id='.length).trim();
      if (!value) {
        throw new Error(`--id requires a join id. ${USAGE}`);
      }
      choose({ kind: 'id', joinId: value });
      continue;
    }

    throw new Error(`Unknown argument "${argument}". ${USAGE}`);
  }

  if (selection === null) {
    throw new Error(USAGE);
  }

  return selection;
}

interface EnrichmentStatusRow {
  join_id: string;
  status: string;
}

function allBookIds(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        'SELECT join_id FROM book_records WHERE hidden = 0 ORDER BY join_id',
      )
      .all() as unknown as { join_id: string }[]
  ).map((entry) => entry.join_id);
}

function crawlSetIds(db: DatabaseSync): string[] {
  const sample = getSampleJoinIds(db);
  return sample !== null ? sample : allBookIds(db);
}

function isHidden(db: DatabaseSync, joinId: string): boolean {
  const row = db
    .prepare('SELECT 1 AS found FROM book_records WHERE join_id = ? AND hidden = 1')
    .get(joinId);
  return row !== undefined;
}

function enrichmentStatuses(db: DatabaseSync): Map<string, string> {
  const rows = db
    .prepare('SELECT join_id, status FROM enrichment')
    .all() as unknown as EnrichmentStatusRow[];
  return new Map(rows.map((row) => [row.join_id, row.status]));
}

export function selectEnrichTargets(
  db: DatabaseSync,
  selection: EnrichSelection,
): string[] {
  if (selection.kind === 'id') {
    return isHidden(db, selection.joinId) ? [] : [selection.joinId];
  }

  const ids = crawlSetIds(db);
  if (selection.kind === 'all') return ids;

  const statuses = enrichmentStatuses(db);
  if (selection.kind === 'unmatched') {
    return ids.filter((joinId) => {
      const status = statuses.get(joinId);
      return status === undefined || status === 'unmatched';
    });
  }

  return ids.filter((joinId) => statuses.get(joinId) === 'failed');
}

function logSingleOutcome(
  outcome: EnrichmentOutcome,
  joinId: string,
  log: (line: string) => void,
  error: (line: string) => void,
): EnrichCliResult {
  switch (outcome.status) {
    case 'enriched': {
      const count = outcome.data.ratingCount ?? 0;
      const pages =
        outcome.data.pageCount !== null ? `, ${outcome.data.pageCount} pages` : '';
      log(
        `Enriched book record ${joinId} from Open Library: ` +
          `"${outcome.candidate.title}" (${count} ratings${pages}, ` +
          `${outcome.data.subjects.length} subjects).`,
      );
      return { exitCode: 0, outcome };
    }
    case 'unmatched':
      log(
        `No Open Library match for book record ${joinId}; ` +
          'marked rating/subjects unknown.',
      );
      return { exitCode: 0, outcome };
    case 'failed':
      error(`Could not enrich book record ${joinId}: ${outcome.error}`);
      return { exitCode: 1, outcome };
  }
}

export async function runEnrichCli(
  argv: readonly string[],
  deps: EnrichCliDeps,
): Promise<EnrichCliResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));

  let selection: EnrichSelection;
  try {
    selection = parseEnrichArgs(argv);
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught));
    return { exitCode: 1 };
  }

  const adapters =
    deps.adapters ??
    new EnrichmentAdapterRegistry(deps.adapter ? [deps.adapter] : []);
  if (adapters.size === 0) {
    error('No enrichment adapter is configured.');
    return { exitCode: 1 };
  }

  const joinIds = selectEnrichTargets(deps.db, selection);
  const delayMs = deps.delayMs ?? 0;
  const sleep = deps.sleep ?? defaultSleep;
  const summary: EnrichSummary = { enriched: 0, unmatched: 0, failed: 0 };
  const outcomes: EnrichmentOutcome[] = [];

  for (let index = 0; index < joinIds.length; index += 1) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);

    const joinId = joinIds[index];
    let outcome: EnrichmentOutcome;
    try {
      outcome = await enrichBook(deps.db, adapters, joinId, {
        now: deps.now,
      });
    } catch (caught) {
      error(caught instanceof Error ? caught.message : String(caught));
      if (selection.kind === 'id') return { exitCode: 1 };
      summary.failed += 1;
      continue;
    }

    summary[outcome.status] += 1;
    outcomes.push(outcome);

    if (selection.kind === 'id') {
      return logSingleOutcome(outcome, joinId, log, error);
    }

    if (outcome.status === 'failed') {
      error(`Could not enrich book record ${joinId}: ${outcome.error}`);
    }
  }

  if (selection.kind === 'id') {
    return { exitCode: 0 };
  }

  log(
    `Refreshed enrichment for ${joinIds.length} book record(s): ` +
      `${summary.enriched} enriched, ${summary.unmatched} unmatched, ` +
      `${summary.failed} failed.`,
  );

  return {
    exitCode: summary.failed > 0 ? 1 : 0,
    summary,
    outcomes,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  const adapters = createAdapterRegistry();
  const delayMs = parseDelayMs(
    process.env.ENRICH_REQUEST_DELAY_MS ??
      process.env.LIBIB_REQUEST_DELAY_MS,
    DEFAULT_ENRICH_DELAY_MS,
  );

  try {
    const result = await runEnrichCli(process.argv.slice(2), {
      db,
      adapters,
      delayMs,
    });
    process.exitCode = result.exitCode;
  } finally {
    db.close();
  }
}
