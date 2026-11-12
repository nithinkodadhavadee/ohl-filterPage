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
  purgeExpiredAnalytics,
  readAnalyticsSummary,
} from './analytics.js';
import { createAnalyticsCapture } from './analytics-http.js';
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
import { isHoldBucket } from '../shared/contract.js';
import { isRunKind } from '../shared/run-log.js';
import {
  parseBoolean,
  parseDirection,
  parseInteger,
  parseNumber,
  parseSort,
  parseUnmatched,
  toArray,
  type BooksQueryParams,
} from './query-params.js';

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
  let startup: StartupHandle | null = null;
  let scheduled: ScheduledScanHandle | null = null;

  purgeExpiredAnalytics(db, config.analyticsRetentionDays, now());

  const analytics = createAnalyticsCapture({
    db,
    now,
    settleMs: analyticsSettleMs,
  });

  app.addHook('onRequest', async (request) => {
    if (request.method !== 'GET') return;
    analytics.captureVisit(request);
  });

  app.addHook('onResponse', async (request, reply) => {
    analytics.captureError(request, reply.statusCode);
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
    analytics.flush();
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
      const result = analytics.captureBeacon(request, request.body);
      if (result === 'rate-limited') {
        return reply.code(429).send({ error: 'Too many analytics events' });
      }
      if (result === 'invalid') {
        return reply.code(400).send({ error: 'Invalid analytics event' });
      }
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
      analytics.captureCatalogueQuery(request, query, result.total);
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
    analytics.captureBookView(request, book.joinId);
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
