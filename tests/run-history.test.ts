import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { recordRun } from '../src/server/run-log.js';
import type { RunHistoryPage } from '../src/shared/run-log.js';

let app: FastifyInstance;
let dataDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-runs-'));
  const config = loadConfig({ dataDir });
  const db = openDatabase(config);

  for (let index = 0; index < 5; index += 1) {
    const minute = `0${index}`;
    recordRun(db, {
      kind: 'snapshot',
      trigger: 'automatic',
      status: 'ok',
      startedAt: `2026-11-10T10:${minute}:00.000Z`,
      finishedAt: `2026-11-10T10:${minute}:01.000Z`,
      counts: { files: 1 },
    });
  }
  recordRun(db, {
    kind: 'restore',
    trigger: 'manual',
    status: 'failed',
    startedAt: '2026-11-10T11:00:00.000Z',
    finishedAt: '2026-11-10T11:00:02.000Z',
    error: 'Snapshot missing',
  });
  db.close();

  app = await buildApp({ dataDir, serveStatic: false });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function getRuns(query: string): Promise<RunHistoryPage> {
  const response = await app.inject({
    method: 'GET',
    url: `/api/runs?${query}`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as RunHistoryPage;
}

describe('GET /api/runs', () => {
  it('returns a paginated page of one kind newest first', async () => {
    const page = await getRuns('kind=snapshot&limit=2&offset=0');

    expect(page.kind).toBe('snapshot');
    expect(page.runs).toHaveLength(2);
    expect(page.runs.map((run) => run.startedAt)).toEqual([
      '2026-11-10T10:04:00.000Z',
      '2026-11-10T10:03:00.000Z',
    ]);
    expect(page.runs[0]).toMatchObject({
      kind: 'snapshot',
      trigger: 'automatic',
      status: 'ok',
      duration: 1000,
      counts: { files: 1 },
      error: null,
    });
    expect(page.nextOffset).toBe(2);
  });

  it('returns the final page with no next offset and error text', async () => {
    const page = await getRuns('kind=snapshot&limit=2&offset=4');

    expect(page.runs).toHaveLength(1);
    expect(page.nextOffset).toBeNull();

    const failed = await getRuns('kind=restore&limit=20&offset=0');
    expect(failed.runs[0]).toMatchObject({
      status: 'failed',
      error: 'Snapshot missing',
    });
    expect(failed.nextOffset).toBeNull();
  });

  it('defaults to 20 rows and rejects an unknown kind', async () => {
    const page = await getRuns('kind=snapshot');
    expect(page.runs).toHaveLength(5);
    expect(page.nextOffset).toBeNull();

    const response = await app.inject({
      method: 'GET',
      url: '/api/runs?kind=not_a_job',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Unknown run kind' });
  });
});
