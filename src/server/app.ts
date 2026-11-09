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
import { loadConfig } from './config.js';
import {
  getCrawlerStatus,
  startCrawler,
  type CrawlerHandle,
} from './crawler.js';
import { openDatabase } from './db.js';
import { createLibibAdapter } from './libib.js';
import {
  isHoldBucket,
  isSortField,
  normalizeUnmatchedFilter,
  type SortDirection,
  type SortField,
  type UnmatchedFilter,
} from '../shared/contract.js';

export interface BuildAppOptions {
  dataDir?: string;
  port?: number;
  logger?: boolean;
  serveStatic?: boolean;
  crawler?: boolean;
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
  let crawler: CrawlerHandle | null = null;

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
    crawler?.stop();
    await crawler?.done;
    db.close();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/api/status', async () =>
    getCrawlerStatus(db, { enabled: crawlerEnabled }),
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

  if (crawlerEnabled) {
    const libib = createLibibAdapter({
      baseUrl: process.env.LIBIB_BASE_URL,
    });
    crawler = startCrawler({
      db,
      fetchDetail: (joinId) => libib.fetchDetail(joinId),
      adapters: createAdapterRegistry(),
      cycleDelayMs: config.crawlerCycleDelayMs,
      maxBackoffMs: config.crawlerMaxBackoffMs,
      logger: options.logger
        ? (message) => app.log.warn(message)
        : undefined,
    });
  }

  return app;
}
