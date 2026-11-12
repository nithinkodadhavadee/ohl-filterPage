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
  isHoldBucket,
  isSortField,
  normalizeUnmatchedFilter,
  type SortDirection,
  type SortField,
  type UnmatchedFilter,
} from '../shared/contract.js';
import { isRunKind } from '../shared/run-log.js';

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

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig({ dataDir: options.dataDir, port: options.port });
  const db = openDatabase(config);
  const app = Fastify({ logger: options.logger ?? false });
  const crawlerEnabled = options.crawler ?? false;
  const startupEnabled = options.startup ?? crawlerEnabled;
  let startup: StartupHandle | null = null;
  let scheduled: ScheduledScanHandle | null = null;

  const currentStatus = () => {
    const crawler = getCrawlerStatus(db, {
      enabled: crawlerEnabled,
      startup: startup?.status(),
      scheduled: scheduled?.status(),
      now: options.now,
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
  }

  app.addHook('onClose', async () => {
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
    Querystring: {
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
    };
  }>('/api/books', async (request) => {
    const limit = parseInteger(
      request.query.limit,
      DEFAULT_LIMIT,
      1,
      MAX_LIMIT,
    );
    const offset = parseInteger(request.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);

    return getBooks(db, {
      limit,
      offset,
      q: request.query.q,
      sort: parseSort(request.query.sort),
      direction: parseDirection(request.query.direction),
      seed: request.query.seed,
      authors: toArray(request.query.author).filter(Boolean),
      tags: toArray(request.query.tag).filter(Boolean),
      subjects: toArray(request.query.subject).filter(Boolean),
      holds: toArray(request.query.holds).filter(isHoldBucket),
      availableOnly: parseBoolean(request.query.available_only),
      ratingMin: parseNumber(request.query.rating_min, 0, 5),
      includeLowSample: parseBoolean(request.query.include_low_sample),
      pagesMin: parseNumber(
        request.query.pages_min,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      pagesMax: parseNumber(
        request.query.pages_max,
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      unmatched: parseUnmatched(request.query.unmatched),
    });
  });

  app.get('/api/facets', async () => getFacets(db));

  app.get<{
    Params: { joinId: string };
  }>('/api/books/:joinId', async (request, reply) => {
    const book = getBook(db, request.params.joinId);
    if (!book) {
      return reply.code(404).send({ error: 'Book not found' });
    }
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
