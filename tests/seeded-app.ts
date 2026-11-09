import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../src/server/app.js';
import type { BooksResponse } from '../src/server/books.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { seedDatabase } from '../src/server/seed.js';

export interface SeededApp {
  app: FastifyInstance;
  dataDir: string;
  listBooks(query?: string): Promise<BooksResponse>;
  close(): Promise<void>;
}

export async function createSeededApp(prefix: string): Promise<SeededApp> {
  const dataDir = mkdtempSync(
    path.join(tmpdir(), `open-house-library-${prefix}-`),
  );
  const config = loadConfig({ dataDir });
  const db = openDatabase(config);
  seedDatabase(db, { coversDir: config.coversDir });
  db.close();

  const app = await buildApp({ dataDir, serveStatic: false });

  return {
    app,
    dataDir,
    async listBooks(query = '') {
      const response = await app.inject({
        method: 'GET',
        url: `/api/books${query}`,
      });
      expect(response.statusCode).toBe(200);
      return response.json() as BooksResponse;
    },
    async close() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export function titles(body: BooksResponse): string[] {
  return body.books.map((book) => book.title);
}
