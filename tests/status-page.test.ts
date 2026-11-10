import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { recordRun } from '../src/server/run-log.js';
import { seedDatabase } from '../src/server/seed.js';
import {
  STATUS_SECTIONS,
  appendRunHistory,
  countEntries,
  formatRemaining,
  formatRunDuration,
} from '../src/client/status-data.js';
import { STATUS_RUN_KINDS } from '../src/shared/run-log.js';
import type { RunHistoryPage, RunLogEntry } from '../src/shared/run-log.js';

let app: FastifyInstance;
let dataDir: string;
let clientDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-status-page-'));
  clientDir = mkdtempSync(path.join(tmpdir(), 'open-house-status-client-'));
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(
    path.join(clientDir, 'index.html'),
    '<!doctype html><title>status shell</title><div id="root"></div>',
  );

  const config = loadConfig({ dataDir });
  const db = openDatabase(config);
  seedDatabase(db, { coversDir: config.coversDir });
  recordRun(db, {
    kind: 'snapshot',
    trigger: 'automatic',
    status: 'ok',
    startedAt: '2026-11-10T10:00:00.000Z',
    finishedAt: '2026-11-10T10:00:01.000Z',
  });
  db.close();

  app = await buildApp({ dataDir, serveStatic: true, clientDir });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(clientDir, { recursive: true, force: true });
});

describe('status page route', () => {
  it('serves the SPA shell for /status without shadowing API routes', async () => {
    const status = await app.inject({ method: 'GET', url: '/status' });
    expect(status.statusCode).toBe(200);
    expect(status.body).toContain('status shell');

    const trailing = await app.inject({ method: 'GET', url: '/status/' });
    expect(trailing.statusCode).toBe(200);
    expect(trailing.body).toContain('status shell');

    const books = await app.inject({ method: 'GET', url: '/api/books' });
    expect(books.statusCode).toBe(200);
    expect((books.json() as { total: number }).total).toBe(6);

    const apiStatus = await app.inject({ method: 'GET', url: '/api/status' });
    expect(apiStatus.statusCode).toBe(200);

    const runs = await app.inject({
      method: 'GET',
      url: '/api/runs?kind=snapshot',
    });
    expect(runs.statusCode).toBe(200);
    expect((runs.json() as RunHistoryPage).runs).toHaveLength(1);
  });
});

describe('status page data helpers', () => {
  function run(id: number, startedAt: string): RunLogEntry {
    return {
      id,
      kind: 'snapshot',
      trigger: 'automatic',
      status: 'ok',
      startedAt,
      finishedAt: startedAt,
      duration: 0,
      counts: null,
      error: null,
      note: null,
    };
  }

  it('covers every run kind exactly once', () => {
    expect(STATUS_SECTIONS.map((section) => section.kind)).toEqual([
      ...STATUS_RUN_KINDS,
    ]);
    expect(new Set(STATUS_SECTIONS.map((section) => section.kind)).size).toBe(
      STATUS_RUN_KINDS.length,
    );
  });

  it('appends pages and ignores duplicate runs', () => {
    const current = [run(2, '2026-11-10T10:02:00.000Z')];
    const page: RunHistoryPage = {
      kind: 'snapshot',
      runs: [
        run(2, '2026-11-10T10:02:00.000Z'),
        run(1, '2026-11-10T10:01:00.000Z'),
      ],
      nextOffset: null,
    };

    expect(appendRunHistory(current, page).map((entry) => entry.id)).toEqual([
      2, 1,
    ]);
  });

  it('formats durations, remaining time and counts', () => {
    expect(formatRunDuration(null)).toBe('—');
    expect(formatRunDuration(450)).toBe('450 ms');
    expect(formatRunDuration(1500)).toBe('2s');
    expect(formatRunDuration(65000)).toBe('1m 5s');
    expect(formatRunDuration(3720000)).toBe('1h 2m');
    expect(formatRemaining(65000, false)).toBe('~1m 5s remaining');
    expect(formatRemaining(65000, true)).toBe('Stalled');
    expect(formatRemaining(null, false)).toBe('Not available');
    expect(countEntries({ added: 2, sampleSize: 4 })).toEqual([
      { key: 'added', label: 'Added', value: 2 },
      { key: 'sampleSize', label: 'Sample size', value: 4 },
    ]);
  });
});
