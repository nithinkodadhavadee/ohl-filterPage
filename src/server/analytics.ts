import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type {
  AnalyticsBreakdown,
  AnalyticsBookViews,
  AnalyticsDay,
  AnalyticsEventKind,
  AnalyticsSummary,
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

export function purgeExpiredAnalytics(
  db: DatabaseSync,
  retentionDays: number,
  now: Date = new Date(),
): number {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY);
  const result = db
    .prepare('DELETE FROM analytics_events WHERE occurred_at < ?')
    .run(cutoff.toISOString());
  return Number(result.changes);
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

function breakdown(
  db: DatabaseSync,
  sql: string,
  params: SQLInputValue[] = [],
): AnalyticsBreakdown[] {
  return db.prepare(sql).all(...params) as unknown as AnalyticsBreakdown[];
}

function rangeClause(since?: string, until?: string): {
  clause: string;
  params: SQLInputValue[];
} {
  const parts: string[] = [];
  const params: SQLInputValue[] = [];
  if (since) {
    parts.push('occurred_at >= ?');
    params.push(since);
  }
  if (until) {
    parts.push('occurred_at <= ?');
    params.push(until);
  }
  return {
    clause: parts.length > 0 ? `WHERE ${parts.join(' AND ')}` : '',
    params,
  };
}

function andWhere(base: string, range: { clause: string }): string {
  const extra = range.clause.replace(/^WHERE /, '');
  if (!extra) return `WHERE ${base}`;
  return `WHERE ${base} AND ${extra}`;
}

export function readAnalyticsSummary(
  db: DatabaseSync,
  now: Date = new Date(),
): AnalyticsSummary {
  const daily = db
    .prepare(`
      SELECT
        day,
        COUNT(*) AS visits,
        COUNT(DISTINCT CASE WHEN is_bot = 0 THEN visitor_hash END) AS uniqueVisitors,
        SUM(is_bot) AS bots
      FROM analytics_events
      WHERE kind = 'visit'
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `)
    .all() as unknown as AnalyticsDay[];

  const events = breakdown(
    db,
    `
      SELECT kind AS label, COUNT(*) AS count
      FROM analytics_events
      GROUP BY kind
      ORDER BY count DESC, label ASC
    `,
  );

  const searchTotals = db
    .prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(zero_results) AS zeroResults
      FROM analytics_events
      WHERE kind = 'search'
    `)
    .get() as unknown as
    | { total: number; zeroResults: number | null }
    | undefined;

  return {
    generatedAt: now.toISOString(),
    approximate: true,
    pageViews: {
      total: countRows(
        db,
        "SELECT COUNT(*) AS count FROM analytics_events WHERE kind = 'visit'",
      ),
      byPath: breakdown(
        db,
        `
          SELECT COALESCE(path, 'unknown') AS label, COUNT(*) AS count
          FROM analytics_events
          WHERE kind = 'visit'
          GROUP BY path
          ORDER BY count DESC, label ASC
        `,
      ),
    },
    daily: daily.map((entry) => ({
      day: entry.day,
      visits: Number(entry.visits),
      uniqueVisitors: Number(entry.uniqueVisitors),
      bots: Number(entry.bots ?? 0),
    })),
    humans: countRows(
      db,
      "SELECT COUNT(*) AS count FROM analytics_events WHERE kind = 'visit' AND is_bot = 0",
    ),
    bots: countRows(
      db,
      "SELECT COUNT(*) AS count FROM analytics_events WHERE kind = 'visit' AND is_bot = 1",
    ),
    devices: breakdown(
      db,
      `
        SELECT COALESCE(device, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        WHERE kind = 'visit' AND is_bot = 0
        GROUP BY device
        ORDER BY count DESC, label ASC
      `,
    ),
    browsers: breakdown(
      db,
      `
        SELECT COALESCE(browser, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        WHERE kind = 'visit' AND is_bot = 0
        GROUP BY browser
        ORDER BY count DESC, label ASC
      `,
    ),
    operatingSystems: breakdown(
      db,
      `
        SELECT COALESCE(os, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        WHERE kind = 'visit' AND is_bot = 0
        GROUP BY os
        ORDER BY count DESC, label ASC
      `,
    ),
    referrers: breakdown(
      db,
      `
        SELECT COALESCE(referrer_host, 'direct') AS label, COUNT(*) AS count
        FROM analytics_events
        WHERE kind = 'visit'
        GROUP BY referrer_host
        ORDER BY count DESC, label ASC
        LIMIT 25
      `,
    ),
    mostViewedBooks: db
      .prepare(`
        SELECT
          events.detail AS joinId,
          COALESCE(books.title, events.detail) AS title,
          COUNT(*) AS views
        FROM analytics_events AS events
        LEFT JOIN book_records AS books ON books.join_id = events.detail
        WHERE events.kind = 'book_view'
        GROUP BY events.detail
        ORDER BY views DESC, title ASC
        LIMIT 20
      `)
      .all() as unknown as AnalyticsBookViews[],
    events,
    searches: {
      total: Number(searchTotals?.total ?? 0),
      zeroResults: Number(searchTotals?.zeroResults ?? 0),
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
  const where = rangeClause(bounds.since ?? undefined, bounds.until ?? undefined);
  const whereEvents = andWhere("kind = 'visit'", where);
  const whereEventsAll = where.clause ? where.clause : '';

  const events = db
    .prepare(`
      SELECT occurred_at, kind, path, status_code, query, filters, sort,
        result_count, zero_results, referrer_host, device, browser, os,
        is_bot, detail
      FROM analytics_events
      ${where.clause}
      ORDER BY occurred_at ASC, id ASC
    `)
    .all(...where.params) as unknown as EventRow[];

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

  const groupDetail = (kind: string): AnalyticsBreakdown[] =>
    breakdown(
      db,
      `
        SELECT COALESCE(detail, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        ${andWhere(`kind = '${kind}'`, where)}
        GROUP BY detail
        ORDER BY count DESC, label ASC
      `,
      where.params,
    );

  const groupColumn = (column: string, kind: string): AnalyticsBreakdown[] =>
    breakdown(
      db,
      `
        SELECT COALESCE(${column}, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        ${andWhere(`kind = '${kind}'`, where)}
        GROUP BY ${column}
        ORDER BY count DESC, label ASC
      `,
      where.params,
    );

  return {
    generatedAt: now.toISOString(),
    since: bounds.since,
    until: bounds.until,
    totalEvents: events.length,
    visits: countRows(db, `SELECT COUNT(*) AS count FROM analytics_events ${whereEvents}`, where.params),
    humans: countRows(
      db,
      `SELECT COUNT(*) AS count FROM analytics_events ${andWhere("kind = 'visit' AND is_bot = 0", where)}`,
      where.params,
    ),
    bots: countRows(
      db,
      `SELECT COUNT(*) AS count FROM analytics_events ${andWhere("kind = 'visit' AND is_bot = 1", where)}`,
      where.params,
    ),
    searches: searchRows,
    zeroResultSearches: searchRows.filter((entry) => entry.zeroResults),
    filters: groupColumn('filters', 'filter'),
    sorts: groupColumn('sort', 'sort'),
    mostViewedBooks: db
      .prepare(`
        SELECT
          events.detail AS joinId,
          COALESCE(books.title, events.detail) AS title,
          COUNT(*) AS views
        FROM analytics_events AS events
        LEFT JOIN book_records AS books ON books.join_id = events.detail
        ${andWhere("events.kind = 'book_view'", where)}
        GROUP BY events.detail
        ORDER BY views DESC, title ASC
        LIMIT 50
      `)
      .all(...where.params) as unknown as AnalyticsBookViews[],
    outbound: groupDetail('outbound'),
    share: groupDetail('share'),
    scroll: groupDetail('scroll'),
    errors: groupColumn('path', 'error'),
    referrers: db
      .prepare(`
        SELECT COALESCE(referrer_host, 'direct') AS label, COUNT(*) AS count
        FROM analytics_events
        ${whereEventsAll || "WHERE kind = 'visit'"}
        ${whereEventsAll ? "AND kind = 'visit'" : ''}
        GROUP BY referrer_host
        ORDER BY count DESC, label ASC
      `)
      .all(...where.params) as unknown as AnalyticsBreakdown[],
    devices: db
      .prepare(`
        SELECT COALESCE(device, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        ${andWhere("kind = 'visit' AND is_bot = 0", where)}
        GROUP BY device
        ORDER BY count DESC, label ASC
      `)
      .all(...where.params) as unknown as AnalyticsBreakdown[],
    browsers: db
      .prepare(`
        SELECT COALESCE(browser, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        ${andWhere("kind = 'visit' AND is_bot = 0", where)}
        GROUP BY browser
        ORDER BY count DESC, label ASC
      `)
      .all(...where.params) as unknown as AnalyticsBreakdown[],
    operatingSystems: db
      .prepare(`
        SELECT COALESCE(os, 'unknown') AS label, COUNT(*) AS count
        FROM analytics_events
        ${andWhere("kind = 'visit' AND is_bot = 0", where)}
        GROUP BY os
        ORDER BY count DESC, label ASC
      `)
      .all(...where.params) as unknown as AnalyticsBreakdown[],
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
