import { writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { csvLine } from './csv.js';
import { openDatabase } from './db.js';

const USAGE = 'Usage: npm run export:unmatched [-- --out <path>]';

interface UnmatchedRow {
  join_id: string;
  title: string;
  author: string | null;
}

export interface UnmatchedExport {
  csv: string;
  count: number;
}

export function buildUnmatchedExport(db: DatabaseSync): UnmatchedExport {
  const rows = db.prepare(`
    SELECT b.join_id, b.title, b.author
    FROM book_records b
    LEFT JOIN enrichment e ON e.join_id = b.join_id
    WHERE e.join_id IS NULL OR e.status = 'unmatched'
    ORDER BY b.title COLLATE NOCASE, b.join_id
  `).all() as unknown as UnmatchedRow[];

  const lines = [
    csvLine(['join_id', 'title', 'author']),
    ...rows.map((row) =>
      csvLine([row.join_id, row.title, row.author ?? '']),
    ),
  ];

  return { csv: `${lines.join('\n')}\n`, count: rows.length };
}

export interface ExportUnmatchedCliDeps {
  db: DatabaseSync;
  stdout?: (text: string) => void;
  writeFile?: (path: string, text: string) => void;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface ExportUnmatchedCliResult {
  exitCode: number;
  count: number;
  outPath: string | null;
}

export function runExportUnmatchedCli(
  argv: readonly string[],
  deps: ExportUnmatchedCliDeps,
): ExportUnmatchedCliResult {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const writeFile =
    deps.writeFile ??
    ((filePath: string, text: string) => writeFileSync(filePath, text, 'utf8'));
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));

  let outPath: string | null = null;
  let outRequested = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out') {
      outRequested = true;
      outPath = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (argument.startsWith('--out=')) {
      outRequested = true;
      outPath = argument.slice('--out='.length);
      continue;
    }
    error(`Unknown argument "${argument}". ${USAGE}`);
    return { exitCode: 1, count: 0, outPath: null };
  }

  if (outRequested && (!outPath || !outPath.trim())) {
    error(USAGE);
    return { exitCode: 1, count: 0, outPath: null };
  }

  let exported: UnmatchedExport;
  try {
    exported = buildUnmatchedExport(deps.db);
  } catch (caught) {
    error(
      `Could not export unmatched book records: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    );
    return { exitCode: 1, count: 0, outPath };
  }

  if (outPath === null) {
    stdout(exported.csv);
    return { exitCode: 0, count: exported.count, outPath: null };
  }

  try {
    writeFile(outPath, exported.csv);
  } catch (caught) {
    error(
      `Could not write ${outPath}: ${
        caught instanceof Error ? caught.message : String(caught)
      }`,
    );
    return { exitCode: 1, count: exported.count, outPath };
  }

  log(
    `Wrote ${exported.count} unmatched book record(s) to ${outPath}.`,
  );
  return { exitCode: 0, count: exported.count, outPath };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);

  try {
    const result = runExportUnmatchedCli(process.argv.slice(2), { db });
    process.exitCode = result.exitCode;
  } finally {
    db.close();
  }
}
