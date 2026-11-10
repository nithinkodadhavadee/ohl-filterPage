import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createAdapterRegistry } from './adapters.js';
import { loadConfig } from './config.js';
import { parseCsv } from './csv.js';
import { openDatabase } from './db.js';
import type { EnrichmentAdapterRegistry } from './enrichment.js';
import { snapshotOnSuccess } from './snapshot.js';

const USAGE = 'Usage: npm run overrides:import -- <path>';
const REQUIRED_COLUMNS = ['join_id', 'source', 'source_id_or_url'];
const KNOWN_COLUMNS = new Set([...REQUIRED_COLUMNS, 'note']);

export interface OverrideImportIssue {
  line: number;
  message: string;
}

export interface OverrideImportResult {
  exitCode: number;
  imported: number;
  updated: number;
  issues: OverrideImportIssue[];
}

export interface OverrideImportDeps {
  db: DatabaseSync;
  adapters: EnrichmentAdapterRegistry;
  now?: () => Date;
  readFile?: (path: string) => string;
  log?: (line: string) => void;
  error?: (line: string) => void;
  onImported?: (result: OverrideImportResult) => void;
}

function parsePath(argv: readonly string[]): string {
  if (argv.length === 0) {
    throw new Error(USAGE);
  }

  const [filePath, ...rest] = argv;
  if (filePath.startsWith('--')) {
    throw new Error(`Unknown argument "${filePath}". ${USAGE}`);
  }
  if (rest.length > 0) {
    throw new Error(`Unexpected argument "${rest[0]}". ${USAGE}`);
  }
  if (!filePath.trim()) {
    throw new Error(USAGE);
  }

  return filePath.trim();
}

function headerIndex(
  fields: readonly string[],
): { index: Map<string, number>; issue: string | null } {
  const index = new Map<string, number>();
  let issue: string | null = null;

  fields.forEach((field, position) => {
    const name = (position === 0 ? field.replace(/^\uFEFF/, '') : field)
      .trim()
      .toLowerCase();
    if (!KNOWN_COLUMNS.has(name)) return;
    if (index.has(name)) {
      issue = `Duplicate "${name}" column in the CSV header.`;
      return;
    }
    index.set(name, position);
  });

  for (const name of REQUIRED_COLUMNS) {
    if (!index.has(name)) {
      issue = `CSV header must include ${REQUIRED_COLUMNS.join(', ')}.`;
    }
  }

  return { index, issue };
}

export function runOverrideImportCli(
  argv: readonly string[],
  deps: OverrideImportDeps,
): OverrideImportResult {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));
  const readFile = deps.readFile ?? ((filePath: string) => readFileSync(filePath, 'utf8'));

  const result = (
    exitCode: number,
    imported = 0,
    updated = 0,
    issues: OverrideImportIssue[] = [],
  ): OverrideImportResult => ({ exitCode, imported, updated, issues });

  let filePath: string;
  try {
    filePath = parsePath(argv);
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught));
    return result(1);
  }

  let text: string;
  try {
    text = readFile(filePath);
  } catch (caught) {
    error(
      `Could not read ${filePath}: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    );
    return result(1);
  }

  const rows = parseCsv(text);
  if (rows.length === 0) {
    error(`CSV file ${filePath} is empty.`);
    return result(1);
  }

  const header = rows[0];
  const { index, issue: headerIssue } = headerIndex(header.fields);
  if (headerIssue) {
    error(`Line ${header.line}: ${headerIssue}`);
    return result(1);
  }

  const issues: OverrideImportIssue[] = [];
  const valid: Array<{
    joinId: string;
    source: string;
    sourceId: string;
    note: string | null;
  }> = [];
  const bookExists = deps.db.prepare(
    'SELECT 1 AS found FROM book_records WHERE join_id = ?',
  );

  for (const row of rows.slice(1)) {
    if (row.fields.length !== header.fields.length) {
      issues.push({
        line: row.line,
        message: `Expected ${header.fields.length} columns, found ${row.fields.length}.`,
      });
      continue;
    }

    const value = (name: string): string => {
      const position = index.get(name);
      return position === undefined ? '' : row.fields[position].trim();
    };

    const joinId = value('join_id');
    const rawSource = value('source');
    const rawSourceId = value('source_id_or_url');
    const note = value('note');

    if (!joinId) {
      issues.push({ line: row.line, message: 'Missing join_id.' });
      continue;
    }
    if (!rawSource) {
      issues.push({ line: row.line, message: 'Missing source.' });
      continue;
    }
    if (!rawSourceId) {
      issues.push({ line: row.line, message: 'Missing source_id_or_url.' });
      continue;
    }
    if (!bookExists.get(joinId)) {
      issues.push({
        line: row.line,
        message: `Unknown book record "${joinId}".`,
      });
      continue;
    }

    const adapter = deps.adapters.get(rawSource.toLowerCase());
    if (!adapter) {
      issues.push({
        line: row.line,
        message: `Unknown enrichment source "${rawSource}".`,
      });
      continue;
    }

    const sourceId = adapter.normalizeSourceId
      ? adapter.normalizeSourceId(rawSourceId)
      : rawSourceId;
    if (!sourceId) {
      issues.push({
        line: row.line,
        message: `Invalid source record id or URL "${rawSourceId}" for source "${adapter.source}".`,
      });
      continue;
    }

    valid.push({
      joinId,
      source: adapter.source,
      sourceId,
      note: note || null,
    });
  }

  const createdAt = (deps.now?.() ?? new Date()).toISOString();
  const existing = deps.db.prepare(
    'SELECT 1 AS found FROM match_overrides WHERE join_id = ?',
  );
  const upsert = deps.db.prepare(`
    INSERT INTO match_overrides (join_id, source, source_id, note, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(join_id) DO UPDATE SET
      source = excluded.source,
      source_id = excluded.source_id,
      note = excluded.note
  `);

  let imported = 0;
  let updated = 0;

  deps.db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of valid) {
      const wasPresent = existing.get(entry.joinId) !== undefined;
      upsert.run(
        entry.joinId,
        entry.source,
        entry.sourceId,
        entry.note,
        createdAt,
      );
      if (wasPresent) {
        updated += 1;
      } else {
        imported += 1;
      }
    }
    deps.db.exec('COMMIT');
  } catch (caught) {
    deps.db.exec('ROLLBACK');
    throw caught;
  }

  log(
    `Imported ${imported} new and updated ${updated} match override(s) from ${filePath}.`,
  );
  for (const issue of issues) {
    error(`Line ${issue.line}: ${issue.message}`);
  }

  const outcome = result(
    issues.length > 0 ? 1 : 0,
    imported,
    updated,
    issues,
  );
  if (imported + updated > 0) {
    deps.onImported?.(outcome);
  }
  return outcome;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  const adapters = createAdapterRegistry();

  try {
    const result = runOverrideImportCli(process.argv.slice(2), {
      db,
      adapters,
      onImported: snapshotOnSuccess(db, config, (line) => console.error(line)),
    });
    process.exitCode = result.exitCode;
  } finally {
    db.close();
  }
}
