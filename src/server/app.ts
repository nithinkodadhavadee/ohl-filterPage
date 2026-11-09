import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  getBook,
  getBooks,
  type BookSortField,
  type SortDirection,
} from './books.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';

export interface BuildAppOptions {
  dataDir?: string;
  port?: number;
  logger?: boolean;
  serveStatic?: boolean;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const SORT_FIELDS = new Set<BookSortField>([
  'relevance',
  'title',
  'author',
  'holds',
  'year',
  'random',
]);

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

function parseSort(value: string | undefined): BookSortField | undefined {
  if (value === undefined) return undefined;
  return SORT_FIELDS.has(value as BookSortField)
    ? (value as BookSortField)
    : undefined;
}

function parseDirection(value: string | undefined): SortDirection | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = loadConfig({ dataDir: options.dataDir, port: options.port });
  const db = openDatabase(config);
  const app = Fastify({ logger: options.logger ?? false });

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
    db.close();
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get<{
    Querystring: {
      q?: string;
      sort?: string;
      direction?: string;
      seed?: string;
      limit?: string;
      offset?: string;
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
    });
  });

  app.get<{
    Params: { joinId: string };
  }>('/api/books/:joinId', async (request, reply) => {
    const book = getBook(db, request.params.joinId);
    if (!book) {
      return reply.code(404).send({ error: 'Book not found' });
    }
    return book;
  });

  return app;
}
