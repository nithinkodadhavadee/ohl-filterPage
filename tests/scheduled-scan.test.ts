import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig, DEFAULT_CATALOGUE_SCAN_INTERVAL_MS } from '../src/server/config.js';
import type { CrawlerHandle } from '../src/server/crawler.js';
import { openDatabase } from '../src/server/db.js';
import {
  runScheduledScanAndEnrich,
  startScheduledScan,
  type ScheduledSleep,
} from '../src/server/scheduled-scan.js';
import { listSnapshots } from '../src/server/snapshot.js';

const originalInterval = process.env.CATALOGUE_SCAN_INTERVAL_SECONDS;

afterEach(() => {
  if (originalInterval === undefined) {
    delete process.env.CATALOGUE_SCAN_INTERVAL_SECONDS;
  } else {
    process.env.CATALOGUE_SCAN_INTERVAL_SECONDS = originalInterval;
  }
});

describe('CATALOGUE_SCAN_INTERVAL_SECONDS', () => {
  it('defaults to 24 hours', () => {
    delete process.env.CATALOGUE_SCAN_INTERVAL_SECONDS;
    const config = loadConfig({ dataDir: path.join(tmpdir(), 'open-house-scan-config') });
    expect(config.catalogueScanIntervalMs).toBe(DEFAULT_CATALOGUE_SCAN_INTERVAL_MS);
    expect(config.catalogueScanIntervalMs).toBe(86_400_000);
  });

  it('reads the interval from the environment', () => {
    process.env.CATALOGUE_SCAN_INTERVAL_SECONDS = '120';
    const config = loadConfig({ dataDir: path.join(tmpdir(), 'open-house-scan-config') });
    expect(config.catalogueScanIntervalMs).toBe(120_000);
  });

  it('treats zero as disabled', () => {
    process.env.CATALOGUE_SCAN_INTERVAL_SECONDS = '0';
    const config = loadConfig({ dataDir: path.join(tmpdir(), 'open-house-scan-config') });
    expect(config.catalogueScanIntervalMs).toBe(0);
  });
});

interface FakeClock {
  now: () => Date;
  sleep: ScheduledSleep;
  waits: { milliseconds: number; resolve: () => void }[];
  advance: (milliseconds: number) => void;
  fire: () => Promise<void>;
}

function fakeClock(startIso: string): FakeClock {
  let current = new Date(startIso).getTime();
  const waits: FakeClock['waits'] = [];

  const sleep: ScheduledSleep = (milliseconds, signal) =>
    new Promise((resolve) => {
      const entry = {
        milliseconds,
        resolve: () => {
          current += milliseconds;
          resolve();
        },
      };
      waits.push(entry);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });

  return {
    now: () => new Date(current),
    sleep,
    waits,
    advance(milliseconds) {
      current += milliseconds;
    },
    async fire() {
      const next = waits.shift();
      if (!next) throw new Error('No scheduled wait to fire');
      next.resolve();
      await flush();
    },
  };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await flush();
  }
  throw new Error('Timed out waiting for condition');
}

describe('runScheduledScanAndEnrich', () => {
  it('runs the Catalogue scan then a full Enrichment pass', async () => {
    const events: string[] = [];
    const now = new Date('2026-11-10T10:00:00.000Z');

    const result = await runScheduledScanAndEnrich({
      scan: async () => {
        events.push('scan');
      },
      enrich: async () => {
        events.push('enrich');
      },
      intervalMs: 86_400_000,
      now: () => now,
      onEnrichmentComplete: (at) => events.push(`record:${at.toISOString()}`),
    });

    expect(events).toEqual([
      'scan',
      'enrich',
      'record:2026-11-10T10:00:00.000Z',
    ]);
    expect(result).toMatchObject({ ok: true, attempts: 1, error: null });
  });

  it('retries a failed run with bounded backoff before succeeding', async () => {
    const sleeps: number[] = [];
    const now = new Date('2026-11-10T10:00:00.000Z');
    let attempts = 0;

    const result = await runScheduledScanAndEnrich({
      scan: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('Libib unavailable');
      },
      enrich: async () => {},
      intervalMs: 86_400_000,
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      maxAttempts: 3,
      retryBaseMs: 1000,
      retryMaxMs: 2500,
      jitterRatio: 0,
    });

    expect(attempts).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    expect(result).toMatchObject({ ok: true, attempts: 3, error: null });
  });

  it('gives up after the bounded attempts and keeps the last error', async () => {
    const sleeps: number[] = [];
    let attempts = 0;

    const result = await runScheduledScanAndEnrich({
      scan: async () => {
        attempts += 1;
        throw new Error('Libib unavailable');
      },
      enrich: async () => {},
      intervalMs: 86_400_000,
      now: () => new Date('2026-11-10T10:00:00.000Z'),
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      maxAttempts: 4,
      retryBaseMs: 1000,
      retryMaxMs: 2500,
      jitterRatio: 0,
    });

    expect(attempts).toBe(4);
    expect(sleeps).toEqual([1000, 2000, 2500]);
    expect(result).toMatchObject({
      ok: false,
      attempts: 4,
      error: 'Libib unavailable',
    });
  });
});

describe('Scheduled catalogue scan timer', () => {
  it('measures the first run from start and reports status', async () => {
    const clock = fakeClock('2026-11-10T10:00:00.000Z');
    const events: string[] = [];
    let handle: ReturnType<typeof startScheduledScan>;

    handle = startScheduledScan({
      scan: async () => {
        events.push('scan');
        void handle.stop();
      },
      enrich: async () => {
        events.push('enrich');
      },
      intervalMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
      logger: () => {},
    });

    expect(handle.status()).toEqual({
      enabled: true,
      intervalMs: 60_000,
      lastRunAt: null,
      nextRunAt: '2026-11-10T10:01:00.000Z',
      lastError: null,
    });

    await clock.fire();
    await handle.done;

    expect(events).toEqual(['scan', 'enrich']);
    expect(handle.status()).toMatchObject({
      lastRunAt: '2026-11-10T10:01:00.000Z',
      lastError: null,
    });
  });

  it('retries a failure then waits for the next scheduled run', async () => {
    const clock = fakeClock('2026-11-10T10:00:00.000Z');
    const sleeps: number[] = [];
    const now = clock.now;
    let attempts = 0;
    let handle: ReturnType<typeof startScheduledScan>;

    handle = startScheduledScan({
      scan: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('Libib unavailable');
        void handle.stop();
      },
      enrich: async () => {},
      intervalMs: 60_000,
      now,
      sleep: async (milliseconds, signal) => {
        sleeps.push(milliseconds);
        if (milliseconds === 500) {
          clock.advance(milliseconds);
          return;
        }
        await clock.sleep(milliseconds, signal);
      },
      maxAttempts: 3,
      retryBaseMs: 500,
      retryMaxMs: 500,
      jitterRatio: 0,
      logger: () => {},
    });

    await clock.fire();
    await handle.done;

    expect(attempts).toBe(3);
    expect(handle.status()).toMatchObject({
      lastRunAt: '2026-11-10T10:01:00.000Z',
      lastError: null,
    });
    expect(sleeps).toEqual([60_000, 500, 500]);
  });

  it('reports the last error and waits for the next run when retries are exhausted', async () => {
    const clock = fakeClock('2026-11-10T10:00:00.000Z');
    let handle: ReturnType<typeof startScheduledScan>;
    let attempts = 0;

    handle = startScheduledScan({
      scan: async () => {
        attempts += 1;
        if (attempts === 2) void handle.stop();
        throw new Error('Libib unavailable');
      },
      enrich: async () => {},
      intervalMs: 60_000,
      now: clock.now,
      sleep: clock.sleep,
      maxAttempts: 1,
      logger: () => {},
    });

    await clock.fire();
    await waitUntil(() => clock.waits.length === 1);
    await clock.fire();
    await handle.done;

    expect(attempts).toBe(2);
    expect(handle.status()).toMatchObject({
      lastRunAt: '2026-11-10T10:02:00.000Z',
      lastError: 'Libib unavailable',
    });
  });

  it('does not run when the interval is zero', async () => {
    const events: string[] = [];
    const handle = startScheduledScan({
      scan: async () => {
        events.push('scan');
      },
      enrich: async () => {
        events.push('enrich');
      },
      intervalMs: 0,
      logger: () => {},
    });

    await handle.done;
    await handle.stop();

    expect(events).toEqual([]);
    expect(handle.status()).toEqual({
      enabled: false,
      intervalMs: 0,
      lastRunAt: null,
      nextRunAt: null,
      lastError: null,
    });
  });
});

describe('snapshot hooks and status through the app', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-scheduled-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function fakeSweep(): CrawlerHandle {
    return { stop: () => {}, done: Promise.resolve() };
  }

  it('snapshots after the startup scan and Enrichment pass', async () => {
    const app = await buildApp({
      dataDir,
      serveStatic: false,
      startup: true,
      startupDeps: {
        scan: async () => {},
        enrich: async () => {},
        startSweep: fakeSweep,
      },
    });

    try {
      await waitUntil(() => listSnapshots(loadConfig({ dataDir })).length === 2);
      const snapshots = listSnapshots(loadConfig({ dataDir }));
      expect(snapshots).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('snapshots after a scheduled scan and Enrichment pass and reports its status', async () => {
    process.env.CATALOGUE_SCAN_INTERVAL_SECONDS = '60';
    const clock = fakeClock('2026-11-10T10:00:00.000Z');
    const events: string[] = [];

    const seeded = openDatabase(loadConfig({ dataDir }));
    seeded
      .prepare(
        `INSERT INTO crawl_state (key, value) VALUES (?, ?)`,
      )
      .run('last_full_enrichment_at', new Date().toISOString());
    seeded.close();

    const app = await buildApp({
      dataDir,
      serveStatic: false,
      startup: true,
      startupDeps: {
        scan: async () => {
          events.push('scan');
        },
        enrich: async () => {
          events.push('enrich');
        },
        startSweep: fakeSweep,
      },
      scheduledDeps: {
        now: clock.now,
        sleep: clock.sleep,
      },
    });

    try {
      await waitUntil(() => events.length === 1);
      await waitUntil(() => clock.waits.length === 1);

      const before = await app.inject({ method: 'GET', url: '/api/status' });
      expect(before.json()).toMatchObject({
        scheduled: {
          enabled: true,
          intervalMs: 60_000,
          lastRunAt: null,
          nextRunAt: '2026-11-10T10:01:00.000Z',
          lastError: null,
        },
      });

      await clock.fire();
      await waitUntil(() => events.length === 3);

      expect(events).toEqual(['scan', 'scan', 'enrich']);

      await waitUntil(() => listSnapshots(loadConfig({ dataDir })).length === 3);

      const after = await app.inject({ method: 'GET', url: '/api/status' });
      expect(after.json()).toMatchObject({
        scheduled: {
          enabled: true,
          intervalMs: 60_000,
          lastRunAt: '2026-11-10T10:01:00.000Z',
          nextRunAt: '2026-11-10T10:02:00.000Z',
          lastError: null,
        },
      });
    } finally {
      await app.close();
    }
  });
});
