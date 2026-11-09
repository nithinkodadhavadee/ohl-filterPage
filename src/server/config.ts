import fs from 'node:fs';
import path from 'node:path';

export interface AppConfig {
  port: number;
  dataDir: string;
  dbPath: string;
  coversDir: string;
}

export interface ConfigOverrides {
  port?: number;
  dataDir?: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = './data';

function parsePort(value: string | undefined): number {
  if (!value) return DEFAULT_PORT;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536
    ? parsed
    : DEFAULT_PORT;
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
  };
}

export function ensureDataDirs(config: AppConfig): void {
  fs.mkdirSync(config.coversDir, { recursive: true });
}
