import {
  resampleCatalogue,
  scanCatalogue,
  type CatalogueScanDeps,
  type CatalogueScanResult,
} from './catalogue-scan.js';
import { createAdapterRegistry } from './adapters.js';
import { loadConfig } from './config.js';
import { cacheCover } from './covers.js';
import { openDatabase } from './db.js';
import { parseDelayMs } from './delay.js';
import { DEFAULT_ENRICH_DELAY_MS } from './enrichment.js';
import { createLibibAdapter } from './libib.js';
import { DEFAULT_INDEX_DELAY_MS } from './libib-index.js';
import { snapshotOnSuccess } from './snapshot.js';
import { errorMessage } from './util.js';

type Mode = CatalogueScanResult['mode'];

function parseMode(value: string | undefined): Mode {
  if (value === 'scan') return 'scan';
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
  const deps: CatalogueScanDeps = {
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
    trigger: 'manual',
    onComplete: snapshotOnSuccess(db, config, 'manual', (line) =>
      console.error(line),
    ),
  };

  const result =
    mode === 'resample'
      ? await resampleCatalogue(db, deps)
      : await scanCatalogue(db, deps);

  console.log(
    `${mode === 'resample' ? 'Resampled' : 'Scanned'} catalogue: ` +
      `${result.sampleSize} book record(s) in the Crawl set ` +
      `(${result.added} added, ${result.updated} updated, ${result.removed} removed).`,
  );
} catch (error) {
  console.error(
    `Could not ${mode === 'resample' ? 'resample' : 'scan'} the catalogue: ${errorMessage(error)}`,
  );
  process.exitCode = 1;
} finally {
  db.close();
}
