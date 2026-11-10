import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  dbPath: string;
  coversDir: string;
  sampleSize: number;
  crawlerEnabled: boolean;
  crawlerCycleDelayMs: number;
  crawlerMaxBackoffMs: number;
  enrichmentCooldownMs: number;
  catalogueScanIntervalMs: number;
  snapshotsDir: string;
  snapshotRetain: number;
}

export interface ConfigOverrides {
  host?: string;
  port?: number;
  dataDir?: string;
  sampleSize?: number;
  enrichmentCooldownMs?: number;
  catalogueScanIntervalMs?: number;
  snapshotRetain?: number;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = './data';
const DEFAULT_SAMPLE_SIZE = 0;
const DEFAULT_CYCLE_DELAY_SECONDS = 30;
const DEFAULT_MAX_BACKOFF_SECONDS = 900;
const DEFAULT_ENRICHMENT_COOLDOWN_SECONDS = 3600;
const DEFAULT_CATALOGUE_SCAN_INTERVAL_SECONDS = 86400;
const DEFAULT_SNAPSHOT_RETAIN = 10;

export const DEFAULT_CRAWLER_CYCLE_DELAY_MS =
  DEFAULT_CYCLE_DELAY_SECONDS * 1000;
export const DEFAULT_CRAWLER_MAX_BACKOFF_MS =
  DEFAULT_MAX_BACKOFF_SECONDS * 1000;
export const DEFAULT_ENRICHMENT_COOLDOWN_MS =
  DEFAULT_ENRICHMENT_COOLDOWN_SECONDS * 1000;
export const DEFAULT_CATALOGUE_SCAN_INTERVAL_MS =
  DEFAULT_CATALOGUE_SCAN_INTERVAL_SECONDS * 1000;

function parseHost(value: string | undefined): string {
  const host = value?.trim();
  return host ? host : DEFAULT_HOST;
}

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT;
}

function parseSampleSize(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_SAMPLE_SIZE;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_SAMPLE_SIZE;
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseSeconds(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed * 1000 : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return !['false', '0', 'no', 'off'].includes(normalized);
}

export function loadConfig(overrides: ConfigOverrides = {}): AppConfig {
  const host = overrides.host ?? parseHost(process.env.HOST);
  const port = overrides.port ?? parsePort(process.env.PORT);
  const dataDir = path.resolve(
    overrides.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
  );

  return {
    host,
    port,
    dataDir,
    dbPath: path.join(dataDir, 'catalogue.sqlite'),
    coversDir: path.join(dataDir, 'covers'),
    sampleSize:
      overrides.sampleSize ?? parseSampleSize(process.env.SAMPLE_SIZE),
    crawlerEnabled: parseBoolean(process.env.CRAWLER_ENABLED, true),
    crawlerCycleDelayMs: parseSeconds(
      process.env.CYCLE_DELAY_SECONDS,
      DEFAULT_CRAWLER_CYCLE_DELAY_MS,
    ),
    crawlerMaxBackoffMs: parseSeconds(
      process.env.CRAWLER_MAX_BACKOFF_SECONDS,
      DEFAULT_CRAWLER_MAX_BACKOFF_MS,
    ),
    enrichmentCooldownMs:
      overrides.enrichmentCooldownMs ??
      parseSeconds(
        process.env.ENRICH_COOLDOWN_SECONDS,
        DEFAULT_ENRICHMENT_COOLDOWN_MS,
      ),
    catalogueScanIntervalMs:
      overrides.catalogueScanIntervalMs ??
      parseSeconds(
        process.env.CATALOGUE_SCAN_INTERVAL_SECONDS,
        DEFAULT_CATALOGUE_SCAN_INTERVAL_MS,
      ),
    snapshotsDir: path.join(dataDir, 'snapshots'),
    snapshotRetain:
      overrides.snapshotRetain ??
      parsePositiveInteger(
        process.env.SNAPSHOT_RETAIN,
        DEFAULT_SNAPSHOT_RETAIN,
      ),
  };
}

export function ensureDataDirs(config: AppConfig): void {
  fs.mkdirSync(config.coversDir, { recursive: true });
  fs.mkdirSync(config.snapshotsDir, { recursive: true });
}
