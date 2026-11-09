import { refreshBookDetails } from './circulation.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { parseDelayMs } from './delay.js';
import { createLibibAdapter } from './libib.js';
import { DEFAULT_DETAIL_DELAY_MS } from './libib-detail.js';

const config = loadConfig();
const db = openDatabase(config);
const delayMs = parseDelayMs(
  process.env.LIBIB_REQUEST_DELAY_MS,
  DEFAULT_DETAIL_DELAY_MS,
);
const libib = createLibibAdapter({
  baseUrl: process.env.LIBIB_BASE_URL,
});

try {
  const result = await refreshBookDetails(db, {
    fetchDetail: (joinId) => libib.fetchDetail(joinId),
    delayMs,
  });

  if (result.sampleSize === 0) {
    console.log('No sampled books to refresh. Run `npm run index` first.');
  } else {
    const skipped =
      result.skipped > 0
        ? `; ${result.skipped} skipped because Libib returned no detail`
        : '';
    console.log(
      `Refreshed circulation for ${result.refreshed} of ${result.sampleSize} ` +
        `sampled book records${skipped}.`,
    );
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Could not refresh book circulation: ${detail}`);
  process.exitCode = 1;
} finally {
  db.close();
}
