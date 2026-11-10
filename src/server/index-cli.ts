import {
  refreshCatalogueIndex,
  resampleCatalogueIndex,
  type CatalogueIndexResult,
} from './catalogue-index.js';
import { createAdapterRegistry } from './adapters.js';
import { loadConfig } from './config.js';
import { cacheCover } from './covers.js';
import { openDatabase } from './db.js';
import { parseDelayMs } from './delay.js';
import { DEFAULT_ENRICH_DELAY_MS } from './enrichment.js';
import { createLibibAdapter } from './libib.js';
import { DEFAULT_INDEX_DELAY_MS } from './libib-index.js';
import { takeSnapshotSafely } from './snapshot.js';

type Mode = CatalogueIndexResult['mode'];

function parseMode(value: string | undefined): Mode {
  if (value === 'scan' || value === 'index') return 'index';
  if (value === 'resample') return 'resample';
  throw new Error('Usage: catalogue-cli <scan|resample>');
}

const mode = parseMode(process.argv[2]);
const config = loadConfig();
const db = openDatabase(config);
const delayMs = parseDelayMs(
  process.env.LIBIB_REQUEST_DELAY_MS,
  DEFAULT_INDEX_DELAY_MS,
);
const libib = createLibibAdapter({
  baseUrl: process.env.LIBIB_BASE_URL,
  libraryId: process.env.LIBIB_LIBRARY_ID,
  indexDelayMs: delayMs,
});

try {
  const deps = {
    fetchIndex: () => libib.fetchIndex(),
    sampleSize: config.sampleSize,
    cacheCover: (item: Parameters<typeof cacheCover>[0]) =>
      cacheCover(item, { coversDir: config.coversDir }),
    adapters: createAdapterRegistry(),
    enrichDelayMs: parseDelayMs(
      process.env.ENRICH_REQUEST_DELAY_MS ??
        process.env.LIBIB_REQUEST_DELAY_MS,
      DEFAULT_ENRICH_DELAY_MS,
    ),
    logger: (message: string) => console.error(message),
    onComplete: () => {
      takeSnapshotSafely(db, config, { log: (line) => console.error(line) });
    },
  };

  const result =
    mode === 'resample'
      ? await resampleCatalogueIndex(db, deps)
      : await refreshCatalogueIndex(db, deps);

  console.log(
    `${mode === 'resample' ? 'Resampled' : 'Scanned'} catalogue: ` +
      `${result.sampleSize} book record(s) in the Crawl set ` +
      `(${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
  );
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(
    `Could not ${mode === 'resample' ? 'resample' : 'scan'} the catalogue: ${detail}`,
  );
  process.exitCode = 1;
} finally {
  db.close();
}
