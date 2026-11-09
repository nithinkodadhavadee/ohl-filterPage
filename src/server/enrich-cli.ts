import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import {
  enrichBook,
  type EnrichmentAdapter,
  type EnrichmentOutcome,
} from './enrichment.js';
import { OpenLibraryAdapter } from './openlibrary.js';

export interface EnrichCliDeps {
  db: DatabaseSync;
  adapter: EnrichmentAdapter;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface EnrichCliResult {
  exitCode: number;
  outcome?: EnrichmentOutcome;
}

const USAGE = 'Usage: npm run enrich -- --id <joinId>';

export function parseEnrichArgs(argv: readonly string[]): string | null {
  let joinId: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--id') {
      joinId = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument.startsWith('--id=')) {
      joinId = argument.slice('--id='.length);
      continue;
    }
    throw new Error(`Unknown argument "${argument}". ${USAGE}`);
  }

  return joinId && joinId.trim() ? joinId.trim() : null;
}

export async function runEnrichCli(
  argv: readonly string[],
  deps: EnrichCliDeps,
): Promise<EnrichCliResult> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));

  let joinId: string | null;
  try {
    joinId = parseEnrichArgs(argv);
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught));
    return { exitCode: 1 };
  }

  if (!joinId) {
    error(USAGE);
    return { exitCode: 1 };
  }

  let outcome: EnrichmentOutcome;
  try {
    outcome = await enrichBook(deps.db, deps.adapter, joinId, {
      now: deps.now,
    });
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught));
    return { exitCode: 1 };
  }

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
      error(
        `Could not enrich book record ${joinId}: ${outcome.error}`,
      );
      return { exitCode: 1, outcome };
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  const adapter = new OpenLibraryAdapter();

  try {
    const result = await runEnrichCli(process.argv.slice(2), { db, adapter });
    process.exitCode = result.exitCode;
  } finally {
    db.close();
  }
}
