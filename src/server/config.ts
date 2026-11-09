import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  coversDir: string;
  crawlerEnabled: boolean;
  crawlerCycleDelayMs: number;
  crawlerMaxBackoffMs: number;
}

export interface ConfigOverrides {
  port?: number;
  dataDir?: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = './data';
const DEFAULT_CYCLE_DELAY_SECONDS = 30;
const DEFAULT_MAX_BACKOFF_SECONDS = 900;

export const DEFAULT_CRAWLER_CYCLE_DELAY_MS =
  DEFAULT_CYCLE_DELAY_SECONDS * 1000;
export const DEFAULT_CRAWLER_MAX_BACKOFF_MS =
  DEFAULT_MAX_BACKOFF_SECONDS * 1000;

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT;
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
  const port = overrides.port ?? parsePort(process.env.PORT);
  const dataDir = path.resolve(
    overrides.dataDir ?? process.env.DATA_DIR ?? DEFAULT_DATA_DIR,
  );

  return {
    port,
    dataDir,
    dbPath: path.join(dataDir, 'catalogue.sqlite'),
    coversDir: path.join(dataDir, 'covers'),
    crawlerEnabled: parseBoolean(process.env.CRAWLER_ENABLED, true),
    crawlerCycleDelayMs: parseSeconds(
      process.env.CYCLE_DELAY_SECONDS,
      DEFAULT_CRAWLER_CYCLE_DELAY_MS,
    ),
    crawlerMaxBackoffMs: parseSeconds(
      process.env.CRAWLER_MAX_BACKOFF_SECONDS,
      DEFAULT_CRAWLER_MAX_BACKOFF_MS,
    ),
  };
}

export function ensureDataDirs(config: AppConfig): void {
  fs.mkdirSync(config.coversDir, { recursive: true });
}
