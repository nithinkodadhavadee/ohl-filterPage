import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyticsReportCsv,
  readAnalyticsReport,
  recordAnalyticsEvent,
} from '../src/server/analytics.js';
import { runAnalyticsReport } from '../src/server/analytics-cli.js';
import { loadConfig, type AppConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { seedDatabase } from '../src/server/seed.js';

let dataDir: string;
let config: AppConfig;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-analytics-report-'));
  config = loadConfig({ dataDir });
  db = openDatabase(config);
  seedDatabase(db, { coversDir: config.coversDir });
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function seedEvents() {
  recordAnalyticsEvent(db, {
    kind: 'visit',
    occurredAt: '2026-01-10T10:00:00.000Z',
    visitorHash: 'a'.repeat(64),
    isBot: false,
    device: 'desktop',
    browser: 'Safari',
    os: 'macOS',
    referrerHost: 'example.com',
    path: '/',
  });
  recordAnalyticsEvent(db, {
    kind: 'search',
    occurredAt: '2026-01-10T10:01:00.000Z',
    isBot: false,
    query: 'raw search phrase',
    filters: JSON.stringify({ authors: ['Ada Lovelace'] }),
    sort: 'relevance:desc',
    resultCount: 0,
    zeroResults: true,
  });
  recordAnalyticsEvent(db, {
    kind: 'filter',
    occurredAt: '2026-01-10T10:02:00.000Z',
    visitorHash: 'a'.repeat(64),
    filters: JSON.stringify({ authors: ['Ada Lovelace'] }),
  });
  recordAnalyticsEvent(db, {
    kind: 'sort',
    occurredAt: '2026-01-10T10:02:30.000Z',
    visitorHash: 'a'.repeat(64),
    sort: 'relevance:desc',
  });
  recordAnalyticsEvent(db, {
    kind: 'book_view',
    occurredAt: '2026-01-11T09:00:00.000Z',
    visitorHash: 'b'.repeat(64),
    detail: '167806440',
  });
  recordAnalyticsEvent(db, {
    kind: 'outbound',
    occurredAt: '2026-01-11T09:01:00.000Z',
    detail: 'libib',
  });
  recordAnalyticsEvent(db, {
    kind: 'search',
    occurredAt: '2026-02-10T10:00:00.000Z',
    isBot: false,
    query: 'outside the range',
    resultCount: 3,
  });
}

describe('analytics report', () => {
  it('reads a date range with raw Search text and zero-result rows', () => {
    seedEvents();
    const report = readAnalyticsReport(
      db,
      { since: '2026-01-01', until: '2026-01-31' },
      new Date('2026-03-01T00:00:00.000Z'),
    );

    expect(report.totalEvents).toBe(6);
    expect(report.searches.map((entry) => entry.query)).toEqual([
      'raw search phrase',
    ]);
    expect(report.zeroResultSearches).toHaveLength(1);
    expect(report.filters).toEqual([
      { label: JSON.stringify({ authors: ['Ada Lovelace'] }), count: 1 },
    ]);
    expect(report.sorts).toEqual([{ label: 'relevance:desc', count: 1 }]);
    expect(report.mostViewedBooks[0]).toMatchObject({ joinId: '167806440', views: 1 });
    expect(report.outbound).toEqual([{ label: 'libib', count: 1 }]);
    expect(report.referrers).toEqual([{ label: 'example.com', count: 1 }]);
    expect(report.bots).toBe(0);
    expect(report.devices).toEqual([{ label: 'desktop', count: 1 }]);
  });

  it('writes HTML and CSV to DATA_DIR/reports by default', () => {
    seedEvents();
    const exit = runAnalyticsReport(
      ['--since', '2026-01-01', '--until', '2026-01-31'],
      config,
      { db, now: () => new Date('2026-03-01T00:00:00.000Z') },
    );

    expect(exit).toBe(0);
    const htmlPath = path.join(dataDir, 'reports', 'analytics-report.html');
    const csvPath = path.join(dataDir, 'reports', 'analytics-report.csv');
    expect(existsSync(htmlPath)).toBe(true);
    expect(existsSync(csvPath)).toBe(true);

    const html = readFileSync(htmlPath, 'utf8');
    expect(html).toContain('raw search phrase');
    expect(html).toContain('Zero-result searches');
    expect(html).not.toContain('outside the range');

    const csv = readFileSync(csvPath, 'utf8');
    expect(csv.split('\n')[0]).toContain('occurred_at');
    expect(csv).toContain('raw search phrase');
    expect(csv).not.toContain('outside the range');
  });

  it('honours an explicit output directory and fails on an invalid range', () => {
    seedEvents();
    const out = mkdtempSync(path.join(tmpdir(), 'open-house-analytics-out-'));
    try {
      const exit = runAnalyticsReport(['--out', out, '--since=2026-01-01'], config, {
        db,
        now: () => new Date('2026-03-01T00:00:00.000Z'),
      });
      expect(exit).toBe(0);
      expect(existsSync(path.join(out, 'analytics-report.html'))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }

    const failed = runAnalyticsReport(['--since', 'not-a-date'], config, {
      db,
      error: () => undefined,
    });
    expect(failed).toBe(1);
  });

  it('serialises every event into the CSV', () => {
    seedEvents();
    const report = readAnalyticsReport(db);
    const csv = analyticsReportCsv(report);
    expect(csv).toContain('book_view');
    expect(csv).toContain('outbound');
    expect(csv).toContain('outside the range');
  });
});
