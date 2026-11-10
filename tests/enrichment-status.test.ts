import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import type { Book } from '../src/server/books.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { finishRun, recordRun, startRun } from '../src/server/run-log.js';

let dataDir: string;
let app: FastifyInstance | null = null;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-enrichment-status-'));
});

afterEach(async () => {
  await app?.close();
  app = null;
  rmSync(dataDir, { recursive: true, force: true });
});

function insertBook(
  db: DatabaseSync,
  joinId: string,
  options: { hidden?: boolean; enrichedStatus?: string | null } = {},
): void {
  db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, copies, out, holds, first_seen_at,
      last_refreshed_at, hidden
    ) VALUES (?, ?, 'An Author', 0, 0, 0, '2026-11-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z', ?)
  `).run(joinId, `Title ${joinId}`, options.hidden ? 1 : 0);

  if (options.enrichedStatus) {
    db.prepare(`
      INSERT INTO enrichment (join_id, source, status, enriched_at)
      VALUES (?, 'openlibrary', ?, '2026-11-02T00:00:00.000Z')
    `).run(joinId, options.enrichedStatus);
  }
}

describe('GET /api/status enrichment summary', () => {
  it('exposes counts, last full pass, progress, errors and history', async () => {
    const db = openDatabase(loadConfig({ dataDir }));
    insertBook(db, 'visible-enriched', {
      enrichedStatus: 'enriched',
    });
    insertBook(db, 'visible-unmatched', {
      enrichedStatus: 'unmatched',
    });
    insertBook(db, 'visible-failed', { enrichedStatus: 'failed' });
    insertBook(db, 'visible-pending');
    insertBook(db, 'hidden-enriched', {
      hidden: true,
      enrichedStatus: 'enriched',
    });

    const failedId = startRun(db, {
      kind: 'enrichment_pass',
      trigger: 'startup',
      startedAt: '2026-11-10T08:00:00.000Z',
      note: 'all',
    });
    finishRun(db, failedId, {
      status: 'failed',
      error: 'Open Library unavailable',
      counts: { enriched: 0, unmatched: 0, failed: 4, total: 4 },
      finishedAt: '2026-11-10T08:00:05.000Z',
    });

    const fullId = startRun(db, {
      kind: 'enrichment_pass',
      trigger: 'startup',
      startedAt: '2026-11-10T09:00:00.000Z',
      note: 'all',
    });
    finishRun(db, fullId, {
      status: 'ok',
      counts: { enriched: 1, unmatched: 1, failed: 0, total: 2 },
      finishedAt: '2026-11-10T09:05:00.000Z',
    });

    startRun(db, {
      kind: 'enrichment_pass',
      trigger: 'manual',
      startedAt: '2026-11-10T10:00:00.000Z',
      note: 'all',
    });

    recordRun(db, {
      kind: 'catalogue_scan',
      trigger: 'startup',
      status: 'ok',
      startedAt: '2026-11-10T07:00:00.000Z',
      finishedAt: '2026-11-10T07:00:02.000Z',
    });
    recordRun(db, {
      kind: 'book_sweep_cycle',
      trigger: 'automatic',
      status: 'ok',
      startedAt: '2026-11-10T07:30:00.000Z',
      finishedAt: '2026-11-10T07:31:00.000Z',
    });
    db.close();

    app = await buildApp({ dataDir, serveStatic: false });
    const response = await app.inject({ method: 'GET', url: '/api/status' });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      enrichment: Record<string, unknown>;
      runHistory: Array<{ kind: string }>;
    };

    expect(body.enrichment).toMatchObject({
      lastFullPassAt: '2026-11-10T09:05:00.000Z',
      inProgress: true,
      nextScheduledRunAt: null,
      lastError: 'Open Library unavailable',
      counts: {
        enriched: 1,
        unmatched: 1,
        failed: 1,
        pending: 1,
        total: 4,
      },
    });

    expect(
      (body.enrichment.history as Array<{ status: string }>).map(
        (entry) => entry.status,
      ),
    ).toEqual(['running', 'ok', 'failed']);

    expect(body.runHistory.map((entry) => entry.kind)).toEqual([
      'enrichment_pass',
      'enrichment_pass',
      'enrichment_pass',
      'catalogue_scan',
    ]);
  });

  it('exposes a book enriched-at time on the detail output', async () => {
    const db = openDatabase(loadConfig({ dataDir }));
    insertBook(db, 'book-1', { enrichedStatus: 'enriched' });
    db.close();

    app = await buildApp({ dataDir, serveStatic: false });
    const response = await app.inject({
      method: 'GET',
      url: '/api/books/book-1',
    });

    expect(response.statusCode).toBe(200);
    expect((response.json() as Book).enrichedAt).toBe(
      '2026-11-02T00:00:00.000Z',
    );
  });
});
