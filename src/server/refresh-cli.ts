import { refreshBookDetails } from './circulation.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import {
  DEFAULT_DETAIL_DELAY_MS,
  fetchBookDetail,
} from './libib-detail.js';

function parseDelay(value: string | undefined): number {
  if (!value) return DEFAULT_DETAIL_DELAY_MS;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_DETAIL_DELAY_MS;
}

const config = loadConfig();
const db = openDatabase(config);
const delayMs = parseDelay(process.env.LIBIB_REQUEST_DELAY_MS);

try {
  const result = await refreshBookDetails(db, {
    fetchDetail: (joinId) =>
      fetchBookDetail(joinId, {
        baseUrl: process.env.LIBIB_BASE_URL,
      }),
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
