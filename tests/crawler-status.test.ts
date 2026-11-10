import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-status-'));
  const config = loadConfig({ dataDir });
  const db = openDatabase(config);
  const state = db.prepare(
    'INSERT INTO crawl_state (key, value) VALUES (?, ?)',
  );

  state.run('sample_join_ids', JSON.stringify(['100', '101', '102']));
  state.run('last_index_refreshed_at', '2026-11-10T09:30:00.000Z');
  state.run('crawl_cursor', '2');
  state.run('crawl_cycle_started_at', '2026-11-10T10:00:00.000Z');
  state.run('crawl_last_cycle_started_at', '2026-11-10T09:00:00.000Z');
  state.run('crawl_last_cycle_finished_at', '2026-11-10T09:30:00.000Z');
  state.run('crawl_backoff_attempt', '2');
  state.run('crawl_last_outcome', 'throttled');
  state.run('crawl_last_error', 'Libib refused rate');
  db.close();

  app = await buildApp({ dataDir, serveStatic: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('GET /api/status', () => {
  it('reports index freshness, cycle progress, backoff state and last error', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      enabled: false,
      lastIndexRefreshedAt: '2026-11-10T09:30:00.000Z',
      cycle: {
        position: 2,
        total: 3,
        startedAt: '2026-11-10T10:00:00.000Z',
      },
      lastCycle: {
        startedAt: '2026-11-10T09:00:00.000Z',
        finishedAt: '2026-11-10T09:30:00.000Z',
      },
      backoff: {
        attempt: 2,
        active: true,
      },
      lastOutcome: 'throttled',
      lastError: 'Libib refused rate',
      enrichment: {
        lastFullPassAt: null,
        inProgress: false,
        nextScheduledRunAt: null,
        lastError: null,
        counts: {
          enriched: 0,
          unmatched: 0,
          failed: 0,
          pending: 0,
          total: 0,
        },
        history: [],
      },
      runHistory: [],
    });
  });

  it('treats throttling backoff as healthy but a hard crawler error as degraded', async () => {
    const healthy = await app.inject({ method: 'GET', url: '/health' });
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json()).toMatchObject({
      status: 'ok',
      database: 'ok',
      crawler: {
        healthy: true,
        backoff: true,
        lastOutcome: 'throttled',
      },
    });

    const config = loadConfig({ dataDir });
    const writer = openDatabase(config);
    writer
      .prepare(
        "UPDATE crawl_state SET value = 'error' WHERE key = 'crawl_last_outcome'",
      )
      .run();
    writer.close();

    const enabledApp = await buildApp({
      dataDir,
      serveStatic: false,
      crawler: true,
      startup: false,
    });
    try {
      const degraded = await enabledApp.inject({
        method: 'GET',
        url: '/health',
      });
      expect(degraded.statusCode).toBe(503);
      expect(degraded.json()).toMatchObject({
        status: 'degraded',
        database: 'ok',
        crawler: {
          healthy: false,
          lastOutcome: 'error',
        },
      });
    } finally {
      await enabledApp.close();
    }
  });
});
