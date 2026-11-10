import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createAdapterRegistry } from './adapters.js';
import {
  getBook,
  getBooks,
  getFacets,
} from './books.js';
import {
  refreshCatalogueIndex,
  type CatalogueIndexDeps,
} from './catalogue-index.js';
import { loadConfig } from './config.js';
import { cacheCover } from './covers.js';
import {
  getCrawlerStatus,
  startCrawler,
} from './crawler.js';
import { openDatabase } from './db.js';
import { parseDelayMs } from './delay.js';
import { DEFAULT_ENRICH_DELAY_MS } from './enrichment.js';
import { runEnrichCli } from './enrich-cli.js';
import { createLibibAdapter } from './libib.js';
import { DEFAULT_INDEX_DELAY_MS } from './libib-index.js';
import {
  startScheduledScan,
  type ScheduledScanHandle,
  type ScheduledSleep,
} from './scheduled-scan.js';
import { takeSnapshotSafely } from './snapshot.js';
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
  random?: () => number;
}

export interface BuildAppOptions {
  dataDir?: string;
  port?: number;
  logger?: boolean;
  serveStatic?: boolean;
  crawler?: boolean;
  startup?: boolean;
  startupDeps?: StartupOverrides;
  scheduledDeps?: ScheduledScanOverrides;
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

  const clientDir = path.resolve(process.cwd(), 'dist/client');
  if (options.serveStatic && existsSync(clientDir)) {
    await app.register(fastifyStatic, { root: clientDir, prefix: '/' });
  }

  await app.register(fastifyStatic, {
    root: config.coversDir,
    prefix: '/covers/',
    decorateReply: !(options.serveStatic && existsSync(clientDir)),
  });

  app.addHook('onClose', async () => {
    await scheduled?.stop();
    await startup?.stop();
    db.close();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/status', async () =>
    getCrawlerStatus(db, {
      enabled: crawlerEnabled,
      startup: startup?.status(),
      scheduled: scheduled?.status(),
    }),
  );

  app.get<{
    Querystring: {
      q?: string;
      sort?: string;
      direction?: string;
      seed?: string;
      limit?: string;
      offset?: string;
      author?: string;
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
      author: request.query.author,
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

    const runScan =
      options.startupDeps?.scan ??
      (() =>
        refreshCatalogueIndex(db, {
          fetchIndex: () => libib.fetchIndex(),
          sampleSize: config.sampleSize,
          cacheCover: (item) =>
            cacheCover(item, { coversDir: config.coversDir }),
          logger,
        } satisfies CatalogueIndexDeps));

    const runEnrich =
      options.startupDeps?.enrich ??
      ((context) =>
        runEnrichCli(['--all'], {
          db,
          adapters: createAdapterRegistry(),
          delayMs: enrichDelayMs,
          signal: context.signal,
          error: logger ?? ((line: string) => console.error(line)),
        }));

    const snapshot = (): void => {
      takeSnapshotSafely(db, config, { log: logger });
    };

    const scan = async (): Promise<unknown> => {
      const result = await runScan();
      snapshot();
      return result;
    };

    const enrich = async (
      context: StartupTaskContext,
    ): Promise<unknown> => {
      const result = await runEnrich(context);
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
      scan,
      enrich,
      startSweep,
      cooldownMs: config.enrichmentCooldownMs,
      logger,
    });

    scheduled = startScheduledScan({
      scan,
      enrich,
      intervalMs: config.catalogueScanIntervalMs,
      now: options.scheduledDeps?.now,
      sleep: options.scheduledDeps?.sleep,
      maxAttempts: options.scheduledDeps?.maxAttempts,
      retryBaseMs: options.scheduledDeps?.retryBaseMs,
      retryMaxMs: options.scheduledDeps?.retryMaxMs,
      jitterRatio: options.scheduledDeps?.jitterRatio,
      random: options.scheduledDeps?.random,
      logger,
      onEnrichmentComplete: (at) => recordFullEnrichment(db, at),
    });
  }

  return app;
}
