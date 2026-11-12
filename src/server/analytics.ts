import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  RETENTION_FOREVER,
  type AnalyticsBreakdown,
  type AnalyticsBookViews,
  type AnalyticsDay,
  type AnalyticsEventKind,
  type AnalyticsSummary,
} from '../shared/analytics.js';

const SALT_KEY = 'visitor_salt';
const SALT_DAY_KEY = 'visitor_salt_day';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface AnalyticsEventInput {
  kind: AnalyticsEventKind;
  occurredAt: Date | string;
  visitorHash?: string | null;
  isBot?: boolean;
  device?: string | null;
  browser?: string | null;
  os?: string | null;
  referrerHost?: string | null;
  path?: string | null;
  statusCode?: number | null;
  query?: string | null;
  filters?: string | null;
  sort?: string | null;
  resultCount?: number | null;
  zeroResults?: boolean | null;
  detail?: string | null;
}

export interface UserAgentInfo {
  device: string;
  browser: string;
  os: string;
  bot: boolean;
}

const BOT_PATTERNS: readonly RegExp[] = [
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /crawl/i,
  /slurp/i,
  /archiver/i,
  /curl\//i,
  /wget\//i,
  /python-requests/i,
  /python-urllib/i,
  /aiohttp/i,
  /httpclient/i,
  /go-http-client/i,
  /node-fetch/i,
  /axios/i,
  /undici/i,
  /libwww/i,
  /headlesschrome/i,
  /phantomjs/i,
  /lighthouse/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /slackbot/i,
  /discordbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /pinterest/i,
  /embedly/i,
  /bingpreview/i,
  /ahrefs/i,
  /semrush/i,
  /mj12bot/i,
  /dotbot/i,
  /petalbot/i,
  /bytespider/i,
  /gptbot/i,
  /claudebot/i,
  /ccbot/i,
  /applebot/i,
  /google-inspectiontool/i,
  /mediapartners-google/i,
  /apis-google/i,
  /feedfetcher/i,
  /yandex/i,
  /baiduspider/i,
  /duckduckbot/i,
];

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function detectOs(userAgent: string): string {
  if (/windows nt/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/cros/i.test(userAgent)) return 'ChromeOS';
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Unknown';
}

function detectDevice(userAgent: string): string {
  if (/ipad|tablet|kindle|silk|playbook/i.test(userAgent)) return 'tablet';
  if (/android/i.test(userAgent) && !/mobile/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|ipod|windows phone/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function detectBrowser(userAgent: string): string {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/opr\/|opera/i.test(userAgent)) return 'Opera';
  if (/samsungbrowser/i.test(userAgent)) return 'Samsung Internet';
  if (/firefox|fxios/i.test(userAgent)) return 'Firefox';
  if (/chrome|crios/i.test(userAgent)) return 'Chrome';
  if (/safari/i.test(userAgent)) return 'Safari';
  if (/curl/i.test(userAgent)) return 'curl';
  if (/wget/i.test(userAgent)) return 'Wget';
  if (/python|aiohttp/i.test(userAgent)) return 'Python';
  if (/node-fetch|axios|undici/i.test(userAgent)) return 'Node';
  return 'Unknown';
}

export function parseUserAgent(
  userAgent: string | null | undefined,
): UserAgentInfo {
  if (!userAgent) {
    return { device: 'unknown', browser: 'unknown', os: 'unknown', bot: false };
  }

  if (isBotUserAgent(userAgent)) {
    return { device: 'bot', browser: 'bot', os: 'bot', bot: true };
  }

  return {
    device: detectDevice(userAgent),
    browser: detectBrowser(userAgent),
    os: detectOs(userAgent),
    bot: false,
  };
}

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readMeta(db: DatabaseSync, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM analytics_meta WHERE key = ?')
    .get(key) as unknown as { value: string } | undefined;
  return row?.value ?? null;
}

function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare(`
    INSERT INTO analytics_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

export function visitorSalt(db: DatabaseSync, now: Date = new Date()): string {
  const day = utcDay(now);
  const storedDay = readMeta(db, SALT_DAY_KEY);
  const storedSalt = readMeta(db, SALT_KEY);

  if (storedDay === day && storedSalt) return storedSalt;

  const salt = randomBytes(32).toString('hex');
  writeMeta(db, SALT_KEY, salt);
  writeMeta(db, SALT_DAY_KEY, day);
  return salt;
}

export function computeVisitorHash(
  salt: string,
  ip: string | null | undefined,
  userAgent: string | null | undefined,
): string {
  return createHash('sha256')
    .update(salt)
    .update('|')
    .update(ip ?? '')
    .update('|')
    .update(userAgent ?? '')
    .digest('hex');
}

export function visitorHashFor(
  db: DatabaseSync,
  ip: string | null | undefined,
  userAgent: string | null | undefined,
  now: Date = new Date(),
): string {
  return computeVisitorHash(visitorSalt(db, now), ip, userAgent);
}

export function recordAnalyticsEvent(
  db: DatabaseSync,
  input: AnalyticsEventInput,
): void {
  const occurredAt =
    typeof input.occurredAt === 'string'
      ? input.occurredAt
      : input.occurredAt.toISOString();

  db.prepare(`
    INSERT INTO analytics_events (
      kind, occurred_at, day, visitor_hash, is_bot, device, browser, os,
      referrer_host, path, status_code, query, filters, sort, result_count,
      zero_results, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.kind,
    occurredAt,
    occurredAt.slice(0, 10),
    input.visitorHash ?? null,
    input.isBot ? 1 : 0,
    input.device ?? null,
    input.browser ?? null,
    input.os ?? null,
    input.referrerHost ?? null,
    input.path ?? null,
    input.statusCode ?? null,
    input.query ?? null,
    input.filters ?? null,
    input.sort ?? null,
    input.resultCount ?? null,
    input.zeroResults ? 1 : 0,
    input.detail ?? null,
  );
}

function countRows(
  db: DatabaseSync,
  sql: string,
  params: SQLInputValue[] = [],
): number {
  const row = db.prepare(sql).get(...params) as unknown as
    | { count: number }
    | undefined;
  return Number(row?.count ?? 0);
}

function rollupAnalyticsBefore(db: DatabaseSync, cutoffDay: string): number {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO analytics_daily (
        day, kind, is_bot, path, device, browser, os, referrer_host,
        filters, sort, detail, zero_results, events
      )
      SELECT
        day, kind, is_bot,
        COALESCE(path, ''), COALESCE(device, ''), COALESCE(browser, ''),
        COALESCE(os, ''), COALESCE(referrer_host, ''), COALESCE(filters, ''),
        COALESCE(sort, ''), COALESCE(detail, ''), zero_results, COUNT(*)
      FROM analytics_events
      WHERE day < ?
      GROUP BY day, kind, is_bot, path, device, browser, os, referrer_host,
        filters, sort, detail, zero_results
      ON CONFLICT (
        day, kind, is_bot, path, device, browser, os, referrer_host,
        filters, sort, detail, zero_results
      )
      DO UPDATE SET events = analytics_daily.events + excluded.events
    `).run(cutoffDay);

    db.prepare(`
      INSERT INTO analytics_daily_visitors (day, unique_visitors)
      SELECT day, COUNT(DISTINCT visitor_hash)
      FROM analytics_events
      WHERE day < ? AND kind = 'visit' AND is_bot = 0
        AND visitor_hash IS NOT NULL
      GROUP BY day
      ON CONFLICT (day) DO UPDATE SET
        unique_visitors = excluded.unique_visitors
    `).run(cutoffDay);

    const result = db
      .prepare('DELETE FROM analytics_events WHERE day < ?')
      .run(cutoffDay);
    db.exec('COMMIT');
    return Number(result.changes);
  } catch (caught) {
    db.exec('ROLLBACK');
    throw caught;
  }
}

export function purgeExpiredAnalytics(
  db: DatabaseSync,
  retentionDays: number,
  now: Date = new Date(),
): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= RETENTION_FOREVER) {
    return 0;
  }
  const cutoffDay = utcDay(
    new Date(now.getTime() - retentionDays * MS_PER_DAY),
  );
  const expired = countRows(
    db,
    'SELECT COUNT(*) AS count FROM analytics_events WHERE day < ?',
    [cutoffDay],
  );
  if (expired === 0) return 0;

  return rollupAnalyticsBefore(db, cutoffDay);
}

interface SqlFilter {
  clause: string;
  params: SQLInputValue[];
}

interface AnalyticsScope {
  daily: SqlFilter;
  raw: SqlFilter;
}

const ALL_SCOPE: AnalyticsScope = {
  daily: { clause: '', params: [] },
  raw: { clause: '', params: [] },
};

function whereWith(condition: string, filter: SqlFilter): string {
  const extra = filter.clause.replace(/^WHERE\s+/, '');
  const parts = [condition, extra].filter(Boolean);
  return parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '';
}

function combinedMetric(
  db: DatabaseSync,
  condition: string,
  scope: AnalyticsScope,
  dailyExpression: string,
  rawExpression: string,
): number {
  const row = db
    .prepare(`
      SELECT COALESCE(SUM(value), 0) AS value FROM (
        SELECT ${dailyExpression} AS value
        FROM analytics_daily ${whereWith(condition, scope.daily)}
        UNION ALL
        SELECT ${rawExpression} AS value
        FROM analytics_events ${whereWith(condition, scope.raw)}
      )
    `)
    .get(...scope.daily.params, ...scope.raw.params) as unknown as
    | { value: number }
    | undefined;
  return Number(row?.value ?? 0);
}

function combinedBreakdown(
  db: DatabaseSync,
  condition: string,
  labelExpression: string,
  scope: AnalyticsScope,
  limit?: number,
): AnalyticsBreakdown[] {
  const limitClause = limit === undefined ? '' : `LIMIT ${limit}`;
  return db
    .prepare(`
      SELECT label, SUM(count) AS count FROM (
        SELECT ${labelExpression} AS label, SUM(events) AS count
        FROM analytics_daily ${whereWith(condition, scope.daily)}
        GROUP BY label
        UNION ALL
        SELECT ${labelExpression} AS label, COUNT(*) AS count
        FROM analytics_events ${whereWith(condition, scope.raw)}
        GROUP BY label
      )
      GROUP BY label
      ORDER BY count DESC, label ASC
      ${limitClause}
    `)
    .all(...scope.daily.params, ...scope.raw.params) as unknown as
    AnalyticsBreakdown[];
}

function combinedMostViewedBooks(
  db: DatabaseSync,
  scope: AnalyticsScope,
  limit: number,
): AnalyticsBookViews[] {
  return db
    .prepare(`
      SELECT
        combined.joinId AS joinId,
        COALESCE(books.title, combined.joinId) AS title,
        SUM(combined.views) AS views
      FROM (
        SELECT detail AS joinId, SUM(events) AS views
        FROM analytics_daily
        ${whereWith("kind = 'book_view' AND detail <> ''", scope.daily)}
        GROUP BY detail
        UNION ALL
        SELECT detail AS joinId, COUNT(*) AS views
        FROM analytics_events
        ${whereWith("kind = 'book_view' AND detail <> ''", scope.raw)}
        GROUP BY detail
      ) AS combined
      LEFT JOIN book_records AS books ON books.join_id = combined.joinId
      GROUP BY combined.joinId
      ORDER BY views DESC, title ASC
      LIMIT ${limit}
    `)
    .all(...scope.daily.params, ...scope.raw.params) as unknown as
    AnalyticsBookViews[];
}

function readDailyVisits(db: DatabaseSync): AnalyticsDay[] {
  const visits = db
    .prepare(`
      SELECT day, SUM(visits) AS visits, SUM(bots) AS bots FROM (
        SELECT day, SUM(events) AS visits, SUM(events * is_bot) AS bots
        FROM analytics_daily
        WHERE kind = 'visit'
        GROUP BY day
        UNION ALL
        SELECT day, COUNT(*) AS visits, SUM(is_bot) AS bots
        FROM analytics_events
        WHERE kind = 'visit'
        GROUP BY day
      )
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `)
    .all() as unknown as Array<{
    day: string;
    visits: number;
    bots: number | null;
  }>;

  const uniqueRows = db
    .prepare(`
      SELECT day, SUM(unique_visitors) AS uniqueVisitors FROM (
        SELECT day, unique_visitors FROM analytics_daily_visitors
        UNION ALL
        SELECT day, COUNT(DISTINCT visitor_hash) AS unique_visitors
        FROM analytics_events
        WHERE kind = 'visit' AND is_bot = 0 AND visitor_hash IS NOT NULL
        GROUP BY day
      )
      GROUP BY day
    `)
    .all() as unknown as Array<{ day: string; uniqueVisitors: number }>;

  const uniqueByDay = new Map(
    uniqueRows.map((entry) => [entry.day, Number(entry.uniqueVisitors)]),
  );

  return visits.map((entry) => ({
    day: entry.day,
    visits: Number(entry.visits),
    uniqueVisitors: uniqueByDay.get(entry.day) ?? 0,
    bots: Number(entry.bots ?? 0),
  }));
}

function scopeForBounds(bounds: {
  since: string | null;
  until: string | null;
}): AnalyticsScope {
  const rawParts: string[] = [];
  const rawParams: SQLInputValue[] = [];
  const dailyParts: string[] = [];
  const dailyParams: SQLInputValue[] = [];
  if (bounds.since) {
    rawParts.push('occurred_at >= ?');
    rawParams.push(bounds.since);
    dailyParts.push('day >= ?');
    dailyParams.push(bounds.since.slice(0, 10));
  }
  if (bounds.until) {
    rawParts.push('occurred_at <= ?');
    rawParams.push(bounds.until);
    dailyParts.push('day <= ?');
    dailyParams.push(bounds.until.slice(0, 10));
  }
  return {
    daily: {
      clause: dailyParts.length > 0 ? `WHERE ${dailyParts.join(' AND ')}` : '',
      params: dailyParams,
    },
    raw: {
      clause: rawParts.length > 0 ? `WHERE ${rawParts.join(' AND ')}` : '',
      params: rawParams,
    },
  };
}

export function readAnalyticsSummary(
  db: DatabaseSync,
  now: Date = new Date(),
): AnalyticsSummary {
  const scope = ALL_SCOPE;

  return {
    generatedAt: now.toISOString(),
    approximate: true,
    pageViews: {
      total: combinedMetric(
        db,
        "kind = 'visit'",
        scope,
        'SUM(events)',
        'COUNT(*)',
      ),
      byPath: combinedBreakdown(
        db,
        "kind = 'visit'",
        "COALESCE(NULLIF(path, ''), 'unknown')",
        scope,
      ),
    },
    daily: readDailyVisits(db),
    humans: combinedMetric(
      db,
      "kind = 'visit' AND is_bot = 0",
      scope,
      'SUM(events)',
      'COUNT(*)',
    ),
    bots: combinedMetric(
      db,
      "kind = 'visit' AND is_bot = 1",
      scope,
      'SUM(events)',
      'COUNT(*)',
    ),
    devices: combinedBreakdown(
      db,
      "kind = 'visit' AND is_bot = 0",
      "COALESCE(NULLIF(device, ''), 'unknown')",
      scope,
    ),
    browsers: combinedBreakdown(
      db,
      "kind = 'visit' AND is_bot = 0",
      "COALESCE(NULLIF(browser, ''), 'unknown')",
      scope,
    ),
    operatingSystems: combinedBreakdown(
      db,
      "kind = 'visit' AND is_bot = 0",
      "COALESCE(NULLIF(os, ''), 'unknown')",
      scope,
    ),
    referrers: combinedBreakdown(
      db,
      "kind = 'visit'",
      "COALESCE(NULLIF(referrer_host, ''), 'direct')",
      scope,
      25,
    ),
    mostViewedBooks: combinedMostViewedBooks(db, scope, 20),
    events: combinedBreakdown(db, '', 'kind', scope),
    searches: {
      total: combinedMetric(
        db,
        "kind = 'search'",
        scope,
        'SUM(events)',
        'COUNT(*)',
      ),
      zeroResults: combinedMetric(
        db,
        "kind = 'search'",
        scope,
        'SUM(events * zero_results)',
        'SUM(zero_results)',
      ),
    },
  };
}

export interface AnalyticsSearchRow {
  occurredAt: string;
  query: string;
  filters: string | null;
  sort: string | null;
  resultCount: number;
  zeroResults: boolean;
}

export interface AnalyticsReport {
  generatedAt: string;
  since: string | null;
  until: string | null;
  totalEvents: number;
  visits: number;
  humans: number;
  bots: number;
  searches: AnalyticsSearchRow[];
  zeroResultSearches: AnalyticsSearchRow[];
  filters: AnalyticsBreakdown[];
  sorts: AnalyticsBreakdown[];
  mostViewedBooks: AnalyticsBookViews[];
  outbound: AnalyticsBreakdown[];
  share: AnalyticsBreakdown[];
  scroll: AnalyticsBreakdown[];
  errors: AnalyticsBreakdown[];
  referrers: AnalyticsBreakdown[];
  devices: AnalyticsBreakdown[];
  browsers: AnalyticsBreakdown[];
  operatingSystems: AnalyticsBreakdown[];
  events: Array<{
    occurredAt: string;
    kind: string;
    path: string | null;
    statusCode: number | null;
    query: string | null;
    filters: string | null;
    sort: string | null;
    resultCount: number | null;
    zeroResults: boolean;
    referrerHost: string | null;
    device: string | null;
    browser: string | null;
    os: string | null;
    isBot: boolean;
    detail: string | null;
  }>;
}

interface EventRow {
  occurred_at: string;
  kind: string;
  path: string | null;
  status_code: number | null;
  query: string | null;
  filters: string | null;
  sort: string | null;
  result_count: number | null;
  zero_results: number;
  referrer_host: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  is_bot: number;
  detail: string | null;
}

export interface AnalyticsDateRange {
  since?: string;
  until?: string;
}

function dateBoundary(value: string, edge: 'start' | 'end'): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed.toISOString();
}

export function resolveDateRange(range: AnalyticsDateRange = {}): {
  since: string | null;
  until: string | null;
} {
  return {
    since: range.since ? dateBoundary(range.since, 'start') : null,
    until: range.until ? dateBoundary(range.until, 'end') : null,
  };
}

export function readAnalyticsReport(
  db: DatabaseSync,
  range: AnalyticsDateRange = {},
  now: Date = new Date(),
): AnalyticsReport {
  const bounds = resolveDateRange(range);
  const scope = scopeForBounds(bounds);

  const events = db
    .prepare(`
      SELECT occurred_at, kind, path, status_code, query, filters, sort,
        result_count, zero_results, referrer_host, device, browser, os,
        is_bot, detail
      FROM analytics_events
      ${scope.raw.clause}
      ORDER BY occurred_at ASC, id ASC
    `)
    .all(...scope.raw.params) as unknown as EventRow[];

  const searchRows: AnalyticsSearchRow[] = events
    .filter((entry) => entry.kind === 'search')
    .map((entry) => ({
      occurredAt: entry.occurred_at,
      query: entry.query ?? '',
      filters: entry.filters,
      sort: entry.sort,
      resultCount: Number(entry.result_count ?? 0),
      zeroResults: entry.zero_results === 1,
    }));

  return {
    generatedAt: now.toISOString(),
    since: bounds.since,
    until: bounds.until,
    totalEvents: combinedMetric(db, '', scope, 'SUM(events)', 'COUNT(*)'),
    visits: combinedMetric(
      db,
      "kind = 'visit'",
      scope,
      'SUM(events)',
      'COUNT(*)',
    ),
    humans: combinedMetric(
      db,
      "kind = 'visit' AND is_bot = 0",
      scope,
      'SUM(events)',
      'COUNT(*)',
    ),
    bots: combinedMetric(
      db,
      "kind = 'visit' AND is_bot = 1",
      scope,
      'SUM(events)',
      'COUNT(*)',
    ),
    searches: searchRows,
    zeroResultSearches: searchRows.filter((entry) => entry.zeroResults),
    filters: combinedBreakdown(
      db,
      "kind = 'filter'",
      "COALESCE(NULLIF(filters, ''), 'unknown')",
      scope,
    ),
    sorts: combinedBreakdown(
      db,
      "kind = 'sort'",
      "COALESCE(NULLIF(sort, ''), 'unknown')",
      scope,
    ),
    mostViewedBooks: combinedMostViewedBooks(db, scope, 50),
    outbound: combinedBreakdown(
      db,
      "kind = 'outbound'",
      "COALESCE(NULLIF(detail, ''), 'unknown')",
      scope,
    ),
    share: combinedBreakdown(
      db,
      "kind = 'share'",
      "COALESCE(NULLIF(detail, ''), 'unknown')",
      scope,
    ),
    scroll: combinedBreakdown(
      db,
      "kind = 'scroll'",
      "COALESCE(NULLIF(detail, ''), 'unknown')",
      scope,
    ),
    errors: combinedBreakdown(
      db,
      "kind = 'error'",
      "COALESCE(NULLIF(path, ''), 'unknown')",
      scope,
    ),
    referrers: combinedBreakdown(
      db,
      "kind = 'visit'",
      "COALESCE(NULLIF(referrer_host, ''), 'direct')",
      scope,
    ),
    devices: combinedBreakdown(
      db,
      "kind = 'visit' AND is_bot = 0",
      "COALESCE(NULLIF(device, ''), 'unknown')",
      scope,
    ),
    browsers: combinedBreakdown(
      db,
      "kind = 'visit' AND is_bot = 0",
      "COALESCE(NULLIF(browser, ''), 'unknown')",
      scope,
    ),
    operatingSystems: combinedBreakdown(
      db,
      "kind = 'visit' AND is_bot = 0",
      "COALESCE(NULLIF(os, ''), 'unknown')",
      scope,
    ),
    events: events.map((entry) => ({
      occurredAt: entry.occurred_at,
      kind: entry.kind,
      path: entry.path,
      statusCode: entry.status_code,
      query: entry.query,
      filters: entry.filters,
      sort: entry.sort,
      resultCount: entry.result_count,
      zeroResults: entry.zero_results === 1,
      referrerHost: entry.referrer_host,
      device: entry.device,
      browser: entry.browser,
      os: entry.os,
      isBot: entry.is_bot === 1,
      detail: entry.detail,
    })),
  };
}

export function analyticsReportCsv(report: AnalyticsReport): string {
  const header = [
    'occurred_at',
    'kind',
    'path',
    'status_code',
    'query',
    'filters',
    'sort',
    'result_count',
    'zero_results',
    'referrer_host',
    'device',
    'browser',
    'os',
    'is_bot',
    'detail',
  ];

  const escape = (value: string | number | boolean | null): string => {
    if (value === null) return '';
    const text = String(value);
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [header.join(',')];
  for (const event of report.events) {
    lines.push(
      [
        event.occurredAt,
        event.kind,
        event.path,
        event.statusCode,
        event.query,
        event.filters,
        event.sort,
        event.resultCount,
        event.zeroResults ? 1 : 0,
        event.referrerHost,
        event.device,
        event.browser,
        event.os,
        event.isBot ? 1 : 0,
        event.detail,
      ]
        .map(escape)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
