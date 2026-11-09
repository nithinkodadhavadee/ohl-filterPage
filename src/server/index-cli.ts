import {
  refreshCatalogueIndex,
  resampleCatalogueIndex,
  type CatalogueIndexResult,
} from './catalogue-index.js';
import { createAdapterRegistry } from './adapters.js';
import { loadConfig } from './config.js';
import { cacheCover } from './covers.js';
import { openDatabase } from './db.js';
import { parseEnrichDelay } from './enrich-cli.js';
import { DEFAULT_INDEX_DELAY_MS, fetchCatalogueIndex } from './libib-index.js';

type Mode = CatalogueIndexResult['mode'];

function parseMode(value: string | undefined): Mode {
  if (value === 'index' || value === 'resample') return value;
  throw new Error('Usage: index-cli <index|resample>');
}

function parseDelay(value: string | undefined): number {
  if (!value) return DEFAULT_INDEX_DELAY_MS;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_INDEX_DELAY_MS;
}

const mode = parseMode(process.argv[2]);
const config = loadConfig();
const db = openDatabase(config);
const delayMs = parseDelay(process.env.LIBIB_REQUEST_DELAY_MS);

try {
  const deps = {
    fetchIndex: () =>
      fetchCatalogueIndex({
        baseUrl: process.env.LIBIB_BASE_URL,
        libraryId: process.env.LIBIB_LIBRARY_ID,
        delayMs,
      }),
    cacheCover: (item: Parameters<typeof cacheCover>[0]) =>
      cacheCover(item, { coversDir: config.coversDir }),
    adapters: createAdapterRegistry(),
    enrichDelayMs: parseEnrichDelay(
      process.env.ENRICH_REQUEST_DELAY_MS ??
        process.env.LIBIB_REQUEST_DELAY_MS,
    ),
    logger: (message: string) => console.error(message),
  };

  const result =
    mode === 'resample'
      ? await resampleCatalogueIndex(db, deps)
      : await refreshCatalogueIndex(db, deps);

  console.log(
    `${mode === 'resample' ? 'Resampled' : 'Refreshed'} catalogue index: ` +
      `${result.sampleSize} sampled book records ` +
      `(${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    `Could not ${mode === 'resample' ? 'resample' : 'refresh'} the catalogue index: ${detail}`,
  );
  process.exitCode = 1;
} finally {
  db.close();
}
