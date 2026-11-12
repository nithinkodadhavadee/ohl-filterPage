import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { loadConfig, type AppConfig } from './config.js';
import {
  analyticsReportCsv,
  readAnalyticsReport,
  resolveDateRange,
  type AnalyticsDateRange,
  type AnalyticsReport,
} from './analytics.js';
import { openDatabase } from './db.js';
import { errorMessage } from './util.js';

const USAGE = [
  'Usage: npm run analytics:report -- [--since <date>] [--until <date>] [--out <dir>]',
  '',
  'Writes analytics-report.html and analytics-report.csv to DATA_DIR/reports/',
  'unless --out points at another directory.',
].join('\n');

export interface AnalyticsReportArgs extends AnalyticsDateRange {
  out?: string;
}

function takeValue(
  args: readonly string[],
  index: number,
  flag: string,
): { value: string; next: number } {
  const current = args[index];
  const inline = current.startsWith(`${flag}=`)
    ? current.slice(flag.length + 1)
    : null;
  if (inline !== null) {
    if (!inline) throw new Error(`Missing value for ${flag}`);
    return { value: inline, next: index + 1 };
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return { value, next: index + 2 };
}

export function parseAnalyticsReportArgs(
  args: readonly string[],
): AnalyticsReportArgs {
  const parsed: AnalyticsReportArgs = {};
  let index = 0;
  while (index < args.length) {
    const current = args[index];
    if (current === '--') {
      index += 1;
      continue;
    }
    if (current === '--since' || current.startsWith('--since=')) {
      const taken = takeValue(args, index, '--since');
      parsed.since = taken.value;
      index = taken.next;
      continue;
    }
    if (current === '--until' || current.startsWith('--until=')) {
      const taken = takeValue(args, index, '--until');
      parsed.until = taken.value;
      index = taken.next;
      continue;
    }
    if (current === '--out' || current.startsWith('--out=')) {
      const taken = takeValue(args, index, '--out');
      parsed.out = taken.value;
      index = taken.next;
      continue;
    }
    if (current === '--help' || current === '-h') {
      return parsed;
    }
    throw new Error(`Unknown argument: ${current}`);
  }
  return parsed;
}

function escapeHtml(value: string | number | boolean | null): string {
  if (value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function table(
  title: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  const head = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
  const body =
    rows.length === 0
      ? `<tr><td colspan="${headers.length}">No data.</td></tr>`
      : rows
          .map(
            (row) =>
              `<tr>${row
                .map((cell) => `<td>${escapeHtml(cell)}</td>`)
                .join('')}</tr>`,
          )
          .join('');
  return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function breakdownTable(
  title: string,
  rows: Array<{ label: string; count: number }>,
): string {
  return table(title, ['Value', 'Count'], rows.map((row) => [row.label, row.count]));
}

export function analyticsReportHtml(report: AnalyticsReport): string {
  const searchRows = report.searches.map((row) => [
    row.occurredAt,
    row.query,
    row.filters,
    row.sort,
    row.resultCount,
    row.zeroResults ? 'yes' : 'no',
  ]);
  const zeroRows = report.zeroResultSearches.map((row) => [
    row.occurredAt,
    row.query,
    row.filters,
    row.sort,
  ]);
  const bookRows = report.mostViewedBooks.map((row) => [
    row.title,
    row.joinId,
    row.views,
  ]);
  const errorRows = report.errors.map((row) => [row.label, row.count]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Open House Library — analytics report</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1d1d1f; }
  h1 { margin-bottom: 0.25rem; }
  h2 { font-size: 1.05rem; margin-top: 1.75rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { border: 1px solid #d0d0d5; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f2f2f5; }
  .muted { color: #666; }
</style>
</head>
<body>
<h1>Open House Library — analytics report</h1>
<p class="muted">Generated ${escapeHtml(report.generatedAt)}. Raw data range ${escapeHtml(report.since ?? 'earliest')} to ${escapeHtml(report.until ?? 'latest')}.</p>
${table('Overview', ['Metric', 'Value'], [
  ['Total events', report.totalEvents],
  ['Visits', report.visits],
  ['Humans', report.humans],
  ['Bots', report.bots],
  ['Searches', report.searches.length],
  ['Zero-result searches', report.zeroResultSearches.length],
])}
${table('Searches', ['When', 'Query', 'Filters', 'Sort', 'Results', 'Zero results'], searchRows)}
${table('Zero-result searches', ['When', 'Query', 'Filters', 'Sort'], zeroRows)}
${breakdownTable('Filter use', report.filters)}
${breakdownTable('Sort use', report.sorts)}
${table('Most-viewed books', ['Title', 'Join ID', 'Views'], bookRows)}
${breakdownTable('Outbound clicks', report.outbound)}
${breakdownTable('Share outcomes', report.share)}
${breakdownTable('Scroll depth', report.scroll)}
${table('Errors', ['Path', 'Count'], errorRows)}
${breakdownTable('Referrers', report.referrers)}
${breakdownTable('Devices (humans)', report.devices)}
${breakdownTable('Browsers (humans)', report.browsers)}
${breakdownTable('Operating systems (humans)', report.operatingSystems)}
</body>
</html>
`;
}

export interface AnalyticsReportDeps {
  db: DatabaseSync;
  now?: () => Date;
  log?: (line: string) => void;
  error?: (line: string) => void;
}

export interface AnalyticsReportResult {
  htmlPath: string;
  csvPath: string;
  report: AnalyticsReport;
}

export function writeAnalyticsReport(
  args: AnalyticsReportArgs,
  config: AppConfig,
  deps: AnalyticsReportDeps,
): AnalyticsReportResult {
  const clock = deps.now ?? (() => new Date());
  // Validate the range before touching the filesystem.
  resolveDateRange(args);
  const report = readAnalyticsReport(deps.db, args, clock());
  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(config.dataDir, 'reports');
  mkdirSync(outDir, { recursive: true });

  const htmlPath = path.join(outDir, 'analytics-report.html');
  const csvPath = path.join(outDir, 'analytics-report.csv');
  writeFileSync(htmlPath, analyticsReportHtml(report), 'utf8');
  writeFileSync(csvPath, analyticsReportCsv(report), 'utf8');

  return { htmlPath, csvPath, report };
}

export function runAnalyticsReport(
  args: readonly string[],
  config: AppConfig,
  deps: AnalyticsReportDeps,
): number {
  const log = deps.log ?? ((line: string) => console.log(line));
  const error = deps.error ?? ((line: string) => console.error(line));

  if (args.includes('--help') || args.includes('-h')) {
    log(USAGE);
    return 0;
  }

  try {
    const parsed = parseAnalyticsReportArgs(args);
    const result = writeAnalyticsReport(parsed, config, deps);
    log(`Analytics report written to ${result.htmlPath}`);
    log(`Analytics CSV written to ${result.csvPath}`);
    return 0;
  } catch (caught) {
    error(USAGE);
    error(errorMessage(caught));
    return 1;
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  try {
    process.exitCode = runAnalyticsReport(process.argv.slice(2), config, { db });
  } finally {
    db.close();
  }
}
