import type { DatabaseSync } from 'node:sqlite';
import { DEFAULT_ENRICHMENT_COOLDOWN_MS } from './config.js';
import type { CrawlerHandle } from './crawler.js';
import { errorMessage } from './util.js';

export const LAST_FULL_ENRICHMENT_KEY = 'last_full_enrichment_at';

export type StartupPhase = 'scanning' | 'enriching' | 'idle';

export interface StartupStatus {
  inProgress: boolean;
  phase: StartupPhase;
}

export interface StartupTaskContext {
  signal: AbortSignal;
}

export interface StartupDeps {
  db: DatabaseSync;
  scan: () => Promise<unknown>;
  enrich: (context: StartupTaskContext) => Promise<unknown>;
  startSweep: () => CrawlerHandle;
  now?: () => Date;
  cooldownMs?: number;
  logger?: (message: string) => void;
}

export interface StartupHandle {
  status: () => StartupStatus;
  done: Promise<void>;
  stop: () => Promise<void>;
}

function writeValue(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO crawl_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function readLastFullEnrichmentAt(db: DatabaseSync): string | null {
  const row = db
    .prepare('SELECT value FROM crawl_state WHERE key = ?')
    .get(LAST_FULL_ENRICHMENT_KEY) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function recordFullEnrichment(db: DatabaseSync, at: Date): void {
  writeValue(db, LAST_FULL_ENRICHMENT_KEY, at.toISOString());
}

export function isWithinEnrichmentCooldown(
  db: DatabaseSync,
  now: Date,
  cooldownMs: number,
): boolean {
  const lastRun = readLastFullEnrichmentAt(db);
  if (!lastRun) return false;

  const lastRunMs = Date.parse(lastRun);
  if (!Number.isFinite(lastRunMs)) return false;

  return now.getTime() - lastRunMs < cooldownMs;
}

export function startStartup(deps: StartupDeps): StartupHandle {
  const logger =
    deps.logger ??
    ((message: string) => {
      console.error(message);
    });
  const now = deps.now ?? (() => new Date());
  const cooldownMs = deps.cooldownMs ?? DEFAULT_ENRICHMENT_COOLDOWN_MS;
  const controller = new AbortController();

  let phase: StartupPhase = 'scanning';
  let inProgress = true;
  let sweep: CrawlerHandle | null = null;

  const done = (async () => {
    try {
      await deps.scan();
    } catch (error) {
      logger(`Startup catalogue scan failed: ${errorMessage(error)}`);
    }

    if (controller.signal.aborted) {
      inProgress = false;
      phase = 'idle';
      return;
    }

    try {
      sweep = deps.startSweep();
      void sweep.done.catch((error) => {
        logger(`Book sweep stopped unexpectedly: ${errorMessage(error)}`);
      });
    } catch (error) {
      logger(`Could not start the Book sweep: ${errorMessage(error)}`);
    }

    if (isWithinEnrichmentCooldown(deps.db, now(), cooldownMs)) {
      logger(
        'Skipping startup Enrichment pass: the last full pass finished within ' +
          'the cooldown.',
      );
      inProgress = false;
      phase = 'idle';
      return;
    }

    phase = 'enriching';
    try {
      await deps.enrich({ signal: controller.signal });
      if (!controller.signal.aborted) {
        recordFullEnrichment(deps.db, now());
      }
    } catch (error) {
      logger(`Startup Enrichment pass failed: ${errorMessage(error)}`);
    } finally {
      inProgress = false;
      phase = 'idle';
    }
  })();

  return {
    status: () => ({ inProgress, phase }),
    done,
    async stop() {
      controller.abort();
      sweep?.stop();
      await done;
      await sweep?.done;
    },
  };
}
