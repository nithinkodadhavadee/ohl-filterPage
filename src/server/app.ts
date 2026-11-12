import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createAdapterRegistry } from './adapters.js';
import {
  parseUserAgent,
  purgeExpiredAnalytics,
  readAnalyticsSummary,
  recordAnalyticsEvent,
  visitorHashFor,
} from './analytics.js';
import {
  getBook,
  getBooks,
  getFacets,
} from './books.js';
import {
  scanCatalogue,
  type CatalogueScanDeps,
} from './catalogue-scan.js';
import { loadConfig } from './config.js';
import { cacheCover } from './covers.js';
import {
  getCrawlerStatus,
  startCrawler,
} from './crawler.js';
import { openDatabase } from './db.js';
import { loggerOptions } from './logging.js';
import { parseDelayMs } from './delay.js';
import { getEnrichmentStatus } from './enrichment-status.js';
import { DEFAULT_ENRICH_DELAY_MS } from './enrichment.js';
import { runEnrichCli } from './enrich-cli.js';
import {
  DEFAULT_RUN_HISTORY_LIMIT,
  MAX_RUN_HISTORY_LIMIT,
  readRunHistoryPage,
  type RunTrigger,
} from './run-log.js';
import { createLibibAdapter } from './libib.js';
import { DEFAULT_INDEX_DELAY_MS } from './libib-index.js';
import {
  startScheduledScan,
  type ScheduledScanHandle,
  type ScheduledSleep,
} from './scheduled-scan.js';
import { snapshotOnSuccess } from './snapshot.js';
import {
  getSweepAudit,
  getSweepAuditCsv,
} from './sweep-ledger.js';
import {
  recordFullEnrichment,
  startStartup,
  type StartupDeps,
  type StartupHandle,
  type StartupTaskContext,
} from './startup.js';
import {
  defaultDirectionFor,
  isHoldBucket,
  isSortField,
  normalizeUnmatchedFilter,
  type SortDirection,
  type SortField,
  type UnmatchedFilter,
} from '../shared/contract.js';
import { isRunKind } from '../shared/run-log.js';
import {
  OUTBOUND_DESTINATIONS,
  SCROLL_QUARTILES,
  SHARE_OUTCOMES,
  type AnalyticsBeaconEvent,
} from '../shared/analytics.js';

export interface StartupOverrides {
  scan?: () => Promise<unknown>;
  enrich?: (context: StartupTaskContext) => Promise<unknown>;
  startSweep?: StartupDeps['startSweep'];
}

export interface ScheduledScanOverrides {
  now?: () => Date;
  sleep?: ScheduledSleep;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  jitterRatio?: number;
}

export interface BuildAppOptions {
  dataDir?: string;
  port?: number;
  logger?: boolean;
  serveStatic?: boolean;
  clientDir?: string;
  crawler?: boolean;
  startup?: boolean;
  startupDeps?: StartupOverrides;
  scheduledDeps?: ScheduledScanOverrides;
  now?: () => Date;
  analyticsSettleMs?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function parseSort(value: string | undefined): SortField | undefined {
  if (value === undefined) return undefined;
  return isSortField(value) ? value : undefined;
}

function parseNumber(
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
}

function parseDirection(value: string | undefined): SortDirection | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

function parseUnmatched(value: string | undefined): UnmatchedFilter {
  return normalizeUnmatchedFilter(value);
}

function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseBoolean(value: string | string[] | undefined): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return first === '1' || first === 'true' || first === 'yes';
}

interface BooksQueryParams {
  q?: string;
  sort?: string;
  direction?: string;
  seed?: string;
  limit?: string;
  offset?: string;
  author?: string | string[];
  tag?: string | string[];
  subject?: string | string[];
  holds?: string | string[];
  available_only?: string | string[];
  rating_min?: string;
  include_low_sample?: string | string[];
  pages_min?: string;
  pages_max?: string;
  unmatched?: string;
}

function headerString(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function requestPath(request: FastifyRequest): string {
  const url = request.raw.url ?? request.url ?? '/';
  return url.split('?')[0] || '/';
}

const ASSET_PATH = /\.(?:js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|json|txt|xml)$/i;

function isAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith('/covers/') ||
    pathname.startsWith('/assets/') ||
    ASSET_PATH.test(pathname)
  );
}

function referrerHost(request: FastifyRequest): string | null {
  const referer = headerString(request.headers.referer);
  if (!referer) return null;
  try {
    return new URL(referer).hostname || null;
  } catch {
    return null;
  }
}

function filterDescriptor(
  query: BooksQueryParams,
): Record<string, unknown> | null {
  const descriptor: Record<string, unknown> = {};

  const authors = toArray(query.author).filter(Boolean);
  if (authors.length > 0) descriptor.authors = authors;
  const tags = toArray(query.tag).filter(Boolean);
  if (tags.length > 0) descriptor.tags = tags;
  const subjects = toArray(query.subject).filter(Boolean);
  if (subjects.length > 0) descriptor.subjects = subjects;
  const holds = toArray(query.holds).filter(isHoldBucket);
  if (holds.length > 0) descriptor.holds = holds;
  if (parseBoolean(query.available_only)) descriptor.availableOnly = true;
  const ratingMin = parseNumber(query.rating_min, 0, 5);
  if (ratingMin !== undefined) descriptor.ratingMin = ratingMin;
  if (query.include_low_sample !== undefined) {
    descriptor.includeLowSample = parseBoolean(query.include_low_sample);
  }
  const pagesMin = parseNumber(
    query.pages_min,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (pagesMin !== undefined) descriptor.pagesMin = pagesMin;
  const pagesMax = parseNumber(
    query.pages_max,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (pagesMax !== undefined) descriptor.pagesMax = pagesMax;
  const unmatched = parseUnmatched(query.unmatched);
  if (unmatched !== 'all') descriptor.unmatched = unmatched;

  return Object.keys(descriptor).length > 0 ? descriptor : null;
}

function sortSignatureFor(query: BooksQueryParams): string {
  const sort = parseSort(query.sort) ?? 'title';
  const direction = parseDirection(query.direction) ?? defaultDirectionFor(sort);
  return `${sort}:${direction}`;
}

const BEACON_KEYS = new Set(['event', 'destination', 'result', 'quartile']);

function parseBeaconBody(body: unknown): AnalyticsBeaconEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !BEACON_KEYS.has(key))) return null;

  switch (record.event) {
    case 'outbound':
      if (
        typeof record.destination !== 'string' ||
        !(OUTBOUND_DESTINATIONS as readonly string[]).includes(
          record.destination,
        ) ||
        record.result !== undefined ||
        record.quartile !== undefined
      ) {
        return null;
      }
      return {
        event: 'outbound',
        destination: record.destination as AnalyticsBeaconEvent['destination'],
      };
    case 'share':
      if (
        typeof record.result !== 'string' ||
        !(SHARE_OUTCOMES as readonly string[]).includes(record.result) ||
        record.destination !== undefined ||
        record.quartile !== undefined
      ) {
        return null;
      }
      return {
        event: 'share',
        result: record.result as AnalyticsBeaconEvent['result'],
      };
    case 'scroll':
      if (
        typeof record.quartile !== 'number' ||
        !(SCROLL_QUARTILES as readonly number[]).includes(record.quartile) ||
        record.destination !== undefined ||
        record.result !== undefined
      ) {
        return null;
      }
      return {
        event: 'scroll',
        quartile: record.quartile as AnalyticsBeaconEvent['quartile'],
      };
    case 'filter_reset':
      if (record.destination !== undefined || record.result !== undefined || record.quartile !== undefined) {
        return null;
      }
      return { event: 'filter_reset' };
    default:
      return null;
  }
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig({ dataDir: options.dataDir, port: options.port });
  const db = openDatabase(config);
  const app = Fastify({
    logger: loggerOptions(options.logger ?? false),
    // Trust client-IP headers only from the loopback reverse proxy that
    // terminates TLS (Tailscale Funnel today, Cloudflare later). Direct LAN
    // clients cannot forge X-Forwarded-For and win a trusted identity.
    trustProxy: 'loopback',
  });
  const crawlerEnabled = options.crawler ?? false;
  const startupEnabled = options.startup ?? crawlerEnabled;
  const now = options.now ?? (() => new Date());
  const analyticsSettleMs = options.analyticsSettleMs ?? 800;
  const pendingSearches = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; write: () => void }
  >();
  const lastFilters = new Map<string, string>();
  const lastSorts = new Map<string, string>();
  const beaconBuckets = new Map<string, number[]>();
  const BEACON_WINDOW_MS = 60_000;
  const BEACON_MAX_EVENTS = 30;
  const MAX_TRACKED_CLIENTS = 5000;

  const rememberClient = <T>(map: Map<string, T>, key: string, value: T) => {
    if (map.size > MAX_TRACKED_CLIENTS && !map.has(key)) map.clear();
    map.set(key, value);
  };
  let startup: StartupHandle | null = null;
  let scheduled: ScheduledScanHandle | null = null;

  purgeExpiredAnalytics(db, config.analyticsRetentionDays, now());

  const analyticsContext = (request: FastifyRequest) => {
    const userAgent = headerString(request.headers['user-agent']);
    const info = parseUserAgent(userAgent);
    const occurredAt = now();
    return {
      occurredAt,
      userAgent,
      info,
      visitorHash: visitorHashFor(db, request.ip, userAgent, occurredAt),
    };
  };

  const recordBookView = (request: FastifyRequest, joinId: string): void => {
    const context = analyticsContext(request);
    recordAnalyticsEvent(db, {
      kind: 'book_view',
      occurredAt: context.occurredAt,
      visitorHash: context.visitorHash,
      isBot: context.info.bot,
      device: context.info.device,
      browser: context.info.browser,
      os: context.info.os,
      path: requestPath(request),
      detail: joinId,
    });
  };

  const scheduleSearch = (key: string, write: () => void): void => {
    const pending = pendingSearches.get(key);
    if (pending) clearTimeout(pending.timer);
    if (analyticsSettleMs <= 0) {
      pendingSearches.delete(key);
      write();
      return;
    }
    const timer = setTimeout(() => {
      pendingSearches.delete(key);
      write();
    }, analyticsSettleMs);
    timer.unref?.();
    pendingSearches.set(key, { timer, write });
  };

  const beaconAllowed = (key: string): boolean => {
    const timestamp = now().getTime();
    const recent = (beaconBuckets.get(key) ?? []).filter(
      (entry) => timestamp - entry < BEACON_WINDOW_MS,
    );
    if (recent.length >= BEACON_MAX_EVENTS) {
      rememberClient(beaconBuckets, key, recent);
      return false;
    }
    recent.push(timestamp);
    rememberClient(beaconBuckets, key, recent);
    return true;
  };

  app.addHook('onRequest', async (request) => {
    if (request.method !== 'GET') return;
    const pathname = requestPath(request);
    if (pathname !== '/' && pathname !== '/status' && pathname !== '/status/') {
      return;
    }
    const context = analyticsContext(request);
    recordAnalyticsEvent(db, {
      kind: 'visit',
      occurredAt: context.occurredAt,
      visitorHash: context.visitorHash,
      isBot: context.info.bot,
      device: context.info.device,
      browser: context.info.browser,
      os: context.info.os,
      referrerHost: referrerHost(request),
      path: pathname === '/status/' ? '/status' : pathname,
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    const statusCode = reply.statusCode;
    if (statusCode < 400) return;
    const pathname = requestPath(request);
    if (pathname.startsWith('/api/analytics')) return;
    if (isAssetPath(pathname)) return;
    if (!pathname.startsWith('/api/') && statusCode !== 404) return;

    const context = analyticsContext(request);
    recordAnalyticsEvent(db, {
      kind: 'error',
      occurredAt: context.occurredAt,
      visitorHash: context.visitorHash,
      isBot: context.info.bot,
      device: context.info.device,
      browser: context.info.browser,
      os: context.info.os,
      path: pathname,
      statusCode,
    });
  });

  const currentStatus = () => {
    const crawler = getCrawlerStatus(db, {
      enabled: crawlerEnabled,
      startup: startup?.status(),
      scheduled: scheduled?.status(),
      now,
    });

    return {
      ...crawler,
      enrichment: getEnrichmentStatus(db, {
        nextScheduledRunAt: crawler.scheduled?.nextRunAt ?? null,
      }),
    };
  };

  const clientDir =
    options.clientDir ?? path.resolve(process.cwd(), 'dist/client');
  const servingClient = Boolean(options.serveStatic && existsSync(clientDir));
  if (servingClient) {
    await app.register(fastifyStatic, { root: clientDir, prefix: '/' });
  }

  await app.register(fastifyStatic, {
    root: config.coversDir,
    prefix: '/covers/',
    decorateReply: !servingClient,
  });

  if (servingClient) {
    const sendClient = (_request: FastifyRequest, reply: FastifyReply) =>
      reply.sendFile('index.html');
    app.get('/status', sendClient);
    app.get('/status/', sendClient);
    app.get('/terms', sendClient);
    app.get('/terms/', sendClient);
    app.get('/analytics', sendClient);
    app.get('/analytics/', sendClient);
  }

  app.addHook('onClose', async () => {
    for (const pending of pendingSearches.values()) {
      clearTimeout(pending.timer);
      pending.write();
    }
    pendingSearches.clear();
    await scheduled?.stop();
    await startup?.stop();
    db.close();
  });

  app.get('/health', async (_request, reply) => {
    const status = currentStatus();
    let databaseOk = true;
    try {
      db.prepare('SELECT 1').get();
    } catch {
      databaseOk = false;
    }

    const crawlerHealthy = !status.enabled || status.lastOutcome !== 'error';
    const healthy = databaseOk && crawlerHealthy;

    return reply.code(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      database: databaseOk ? 'ok' : 'error',
      crawler: {
        enabled: status.enabled,
        healthy: crawlerHealthy,
        backoff: status.backoff.active,
        lastOutcome: status.lastOutcome,
        lastError: status.lastError,
      },
      startup: status.startup ?? null,
      scheduled: status.scheduled ?? null,
    });
  });

  app.get('/api/status', async () => currentStatus());

  app.get('/api/analytics/summary', async () => readAnalyticsSummary(db, now()));

  app.post<{ Body: unknown }>(
    '/api/analytics/event',
    { bodyLimit: 1024 },
    async (request, reply) => {
      const context = analyticsContext(request);
      if (!beaconAllowed(context.visitorHash)) {
        return reply.code(429).send({ error: 'Too many analytics events' });
      }

      const event = parseBeaconBody(request.body);
      if (!event) {
        return reply.code(400).send({ error: 'Invalid analytics event' });
      }

      const detail =
        event.event === 'outbound'
          ? event.destination ?? null
          : event.event === 'share'
            ? event.result ?? null
            : event.event === 'scroll'
              ? String(event.quartile)
              : 'reset';

      recordAnalyticsEvent(db, {
        kind: event.event,
        occurredAt: context.occurredAt,
        isBot: context.info.bot,
        detail,
      });

      return reply.code(204).send();
    },
  );

  app.get<{
    Querystring: { kind?: string; limit?: string; offset?: string };
  }>('/api/runs', async (request, reply) => {
    const kind = request.query.kind;
    if (!kind || !isRunKind(kind)) {
      return reply.code(400).send({ error: 'Unknown run kind' });
    }

    return readRunHistoryPage(db, kind, {
      limit: parseInteger(
        request.query.limit,
        DEFAULT_RUN_HISTORY_LIMIT,
        1,
        MAX_RUN_HISTORY_LIMIT,
      ),
      offset: parseInteger(
        request.query.offset,
        0,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
    });
  });

  app.get('/api/sweep/audit', async () => getSweepAudit(db));

  app.get('/api/sweep/audit.csv', async (_request, reply) => {
    const { csv } = getSweepAuditCsv(db);
    return reply.type('text/csv; charset=utf-8').send(csv);
  });

  app.get<{
    Querystring: BooksQueryParams;
  }>('/api/books', async (request) => {
    const query = request.query;
    const limit = parseInteger(query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
    const offset = parseInteger(
      query.offset,
      0,
      0,
      Number.MAX_SAFE_INTEGER,
    );

    const result = getBooks(db, {
      limit,
      offset,
      q: query.q,
      sort: parseSort(query.sort),
      direction: parseDirection(query.direction),
      seed: query.seed,
      authors: toArray(query.author).filter(Boolean),
      tags: toArray(query.tag).filter(Boolean),
      subjects: toArray(query.subject).filter(Boolean),
      holds: toArray(query.holds).filter(isHoldBucket),
      availableOnly: parseBoolean(query.available_only),
      ratingMin: parseNumber(query.rating_min, 0, 5),
      includeLowSample: parseBoolean(query.include_low_sample),
      pagesMin: parseNumber(query.pages_min, 0, Number.MAX_SAFE_INTEGER),
      pagesMax: parseNumber(query.pages_max, 0, Number.MAX_SAFE_INTEGER),
      unmatched: parseUnmatched(query.unmatched),
    });

    if (offset === 0) {
      const context = analyticsContext(request);
      const descriptor = filterDescriptor(query);
      const filterSignature = descriptor ? JSON.stringify(descriptor) : '';
      const previousFilters = lastFilters.get(context.visitorHash);
      if (filterSignature && filterSignature !== previousFilters) {
        recordAnalyticsEvent(db, {
          kind: 'filter',
          occurredAt: context.occurredAt,
          visitorHash: context.visitorHash,
          isBot: context.info.bot,
          path: requestPath(request),
          filters: filterSignature,
        });
      }
      rememberClient(lastFilters, context.visitorHash, filterSignature);

      const sortSignature = sortSignatureFor(query);
      const previousSort = lastSorts.get(context.visitorHash);
      if (previousSort !== undefined && previousSort !== sortSignature) {
        recordAnalyticsEvent(db, {
          kind: 'sort',
          occurredAt: context.occurredAt,
          visitorHash: context.visitorHash,
          isBot: context.info.bot,
          path: requestPath(request),
          sort: sortSignature,
        });
      }
      rememberClient(lastSorts, context.visitorHash, sortSignature);

      const queryText = query.q?.trim() ?? '';
      if (queryText) {
        scheduleSearch(context.visitorHash, () => {
          recordAnalyticsEvent(db, {
            kind: 'search',
            occurredAt: context.occurredAt,
            isBot: context.info.bot,
            query: queryText,
            filters: filterSignature || null,
            sort: sortSignature,
            resultCount: result.total,
            zeroResults: result.total === 0,
          });
        });
      }
    }

    return result;
  });

  app.get('/api/facets', async () => getFacets(db));

  app.get<{
    Params: { joinId: string };
  }>('/api/books/:joinId', async (request, reply) => {
    const book = getBook(db, request.params.joinId);
    if (!book) {
      return reply.code(404).send({ error: 'Book not found' });
    }
    recordBookView(request, book.joinId);
    return book;
  });

  if (startupEnabled) {
    const logger = options.logger
      ? (message: string) => app.log.warn(message)
      : undefined;
    const indexDelayMs = parseDelayMs(
      process.env.LIBIB_REQUEST_DELAY_MS,
      DEFAULT_INDEX_DELAY_MS,
    );
    const libib = createLibibAdapter({
      baseUrl: process.env.LIBIB_BASE_URL,
      indexDelayMs,
    });
    const enrichDelayMs = parseDelayMs(
      process.env.ENRICH_REQUEST_DELAY_MS ??
        process.env.LIBIB_REQUEST_DELAY_MS,
      DEFAULT_ENRICH_DELAY_MS,
    );

    const runScanFor = (trigger: RunTrigger): (() => Promise<unknown>) =>
      options.startupDeps?.scan ??
      (() =>
        scanCatalogue(db, {
          fetchIndex: () => libib.fetchIndex(),
          sampleSize: config.sampleSize,
          cacheCover: (item) =>
            cacheCover(item, { coversDir: config.coversDir }),
          logger,
          trigger,
        } satisfies CatalogueScanDeps));

    const runEnrichFor = (
      trigger: RunTrigger,
    ): ((context: StartupTaskContext) => Promise<unknown>) =>
      options.startupDeps?.enrich ??
      ((context) =>
        runEnrichCli(['--all'], {
          db,
          adapters: createAdapterRegistry(),
          delayMs: enrichDelayMs,
          signal: context.signal,
          error: logger ?? ((line: string) => console.error(line)),
          trigger,
        }));

    const snapshot = snapshotOnSuccess(db, config, 'automatic', logger);

    const scanFor = (trigger: RunTrigger) => async (): Promise<unknown> => {
      const result = await runScanFor(trigger)();
      snapshot();
      return result;
    };

    const enrichFor =
      (trigger: RunTrigger) =>
      async (context: StartupTaskContext): Promise<unknown> => {
        const result = await runEnrichFor(trigger)(context);
        snapshot();
        return result;
      };

    const startSweep =
      options.startupDeps?.startSweep ??
      (() =>
        startCrawler({
          db,
          fetchDetail: (joinId) => libib.fetchDetail(joinId),
          adapters: createAdapterRegistry(),
          cycleDelayMs: config.crawlerCycleDelayMs,
          maxBackoffMs: config.crawlerMaxBackoffMs,
          logger,
        }));

    startup = startStartup({
      db,
      scan: scanFor('startup'),
      enrich: enrichFor('startup'),
      startSweep,
      cooldownMs: config.enrichmentCooldownMs,
      logger,
    });

    scheduled = startScheduledScan({
      scan: scanFor('scheduled'),
      enrich: enrichFor('scheduled'),
      intervalMs: config.catalogueScanIntervalMs,
      now: options.scheduledDeps?.now,
      sleep: options.scheduledDeps?.sleep,
      maxAttempts: options.scheduledDeps?.maxAttempts,
      retryBaseMs: options.scheduledDeps?.retryBaseMs,
      retryMaxMs: options.scheduledDeps?.retryMaxMs,
      jitterRatio: options.scheduledDeps?.jitterRatio,
      logger,
      onEnrichmentComplete: (at) => recordFullEnrichment(db, at),
    });
  }

  return app;
}
