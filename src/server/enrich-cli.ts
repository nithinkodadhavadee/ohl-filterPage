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
import { beginRun, type RunTrigger } from './run-log.js';
import { snapshotOnSuccess } from './snapshot.js';
import { recordFullEnrichment } from './startup.js';
import { errorMessage, sleep as defaultSleep } from './util.js';
import {
  isHiddenBook,
  visibleBookIds,
} from './visibility.js';

export interface EnrichCliDeps {
  db: DatabaseSync;
  adapter?: EnrichmentAdapter;
  adapters?: EnrichmentAdapterRegistry;
  delayMs?: number;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
  signal?: AbortSignal;
  trigger?: RunTrigger;
  onComplete?: (result: EnrichCliResult) => void | Promise<void>;
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

function crawlSetIds(db: DatabaseSync): string[] {
  const sample = getSampleJoinIds(db);
  return sample !== null ? sample : visibleBookIds(db);
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
    return isHiddenBook(db, selection.joinId) ? [] : [selection.joinId];
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
  const clock = deps.now ?? (() => new Date());
  const run = beginRun(
    deps.db,
    {
      kind: 'enrichment_pass',
      trigger: deps.trigger ?? 'manual',
      note: selection.kind === 'id' ? `id:${selection.joinId}` : selection.kind,
    },
    clock,
  );

  const finish = (
    status: 'ok' | 'partial' | 'failed',
    counts: Record<string, number>,
    runError: string | null = null,
    note: string | null = null,
  ): void => {
    run.finish({ status, counts, error: runError, note });
  };

  try {
    for (let index = 0; index < joinIds.length; index += 1) {
      if (deps.signal?.aborted) break;
      if (index > 0 && delayMs > 0) await sleep(delayMs, deps.signal);

      const joinId = joinIds[index];
      let outcome: EnrichmentOutcome;
      try {
        outcome = await enrichBook(deps.db, adapters, joinId, {
          now: deps.now,
        });
      } catch (caught) {
        error(errorMessage(caught));
        if (selection.kind === 'id') {
          finish(
            'failed',
            { enriched: 0, unmatched: 0, failed: 1, total: 1, processed: 0 },
            errorMessage(caught),
          );
          return { exitCode: 1 };
        }
        summary.failed += 1;
        continue;
      }

      summary[outcome.status] += 1;
      outcomes.push(outcome);

      if (selection.kind === 'id') {
        const result = logSingleOutcome(outcome, joinId, log, error);
        const failed = outcome.status === 'failed';
        const runError = outcome.status === 'failed' ? outcome.error : null;
        finish(
          failed ? 'failed' : 'ok',
          {
            enriched: outcome.status === 'enriched' ? 1 : 0,
            unmatched: outcome.status === 'unmatched' ? 1 : 0,
            failed: failed ? 1 : 0,
            total: 1,
            processed: 1,
          },
          runError,
        );
        return result;
      }

      if (outcome.status === 'failed') {
        error(`Could not enrich book record ${joinId}: ${outcome.error}`);
      }
    }

    if (selection.kind === 'id') {
      const noTargets = joinIds.length === 0;
      if (noTargets) {
        log(
          `No visible book record to enrich for ${selection.joinId}.`,
        );
      }
      finish(
        'partial',
        {
          enriched: 0,
          unmatched: 0,
          failed: 0,
          total: joinIds.length,
          processed: outcomes.length,
        },
        noTargets ? 'No book record matched the enrichment request.' : null,
        noTargets ? 'No visible book record to enrich.' : null,
      );
      return { exitCode: 0 };
    }

    log(
      `Refreshed enrichment for ${joinIds.length} book record(s): ` +
        `${summary.enriched} enriched, ${summary.unmatched} unmatched, ` +
        `${summary.failed} failed.`,
    );

    const result: EnrichCliResult = {
      exitCode: summary.failed > 0 ? 1 : 0,
      summary,
      outcomes,
    };

    const aborted = deps.signal?.aborted === true;
    const status =
      summary.failed === 0
        ? aborted
          ? 'partial'
          : 'ok'
        : summary.enriched + summary.unmatched > 0
          ? 'partial'
          : 'failed';
    const runError =
      summary.failed === 0
        ? aborted
          ? 'Enrichment pass was interrupted.'
          : null
        : `${summary.failed} of ${joinIds.length} book record(s) failed to enrich.`;

    finish(status, {
      enriched: summary.enriched,
      unmatched: summary.unmatched,
      failed: summary.failed,
      total: joinIds.length,
      processed: outcomes.length,
    }, runError);

    if (selection.kind === 'all') {
      if (!deps.signal?.aborted) {
        recordFullEnrichment(deps.db, clock());
      }
      await deps.onComplete?.(result);
    }

    return result;
  } catch (caught) {
    finish(
      'failed',
      {
        enriched: summary.enriched,
        unmatched: summary.unmatched,
        failed: summary.failed,
        total: joinIds.length,
        processed: outcomes.length,
      },
      errorMessage(caught),
    );
    throw caught;
  }
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
      onComplete: snapshotOnSuccess(db, config, 'manual', (line) =>
        console.error(line),
      ),
    });
    process.exitCode = result.exitCode;
  } finally {
    db.close();
  }
}
