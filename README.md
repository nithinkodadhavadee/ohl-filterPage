# Open House Library Discovery

A local, read-only discovery page over the Open House Library's Libib catalogue.

## Requirements

- Node 26
- npm

## Setup

```sh
npm install
npm run seed
```

The seed command writes fixtures into `DATA_DIR` (default `./data`) and never
contacts Libib.

To replace the fixtures with the 50-book sample from the live catalogue:

```sh
npm run index
```

This reads the full Libib Catalogue index, freezes the first 50 titles from A
onward, stores only those book records and caches their covers under
`DATA_DIR/covers`. Running it again refreshes the sampled records without adding
new books. To re-pick the sample (for example after the library adds titles):

```sh
npm run resample
```

Both commands are polite: requests are sequential, spacing defaults to one
second and can be changed with `LIBIB_REQUEST_DELAY_MS`. They stop with a clear
error if Libib returns 403 or 429.

To fill in each sampled book's circulation, description, publication data and
Libib tags, refresh the per-book details:

```sh
npm run refresh
```

This reads one detail request per sampled book with a polite gap (two seconds by
default) and can be re-run safely. It skips books Libib no longer returns and
stops with a clear error if Libib refuses a request with 403 or 429.

Normal server start also runs the rolling crawler: one sampled book every
`CYCLE_DELAY_SECONDS` (default 30), resuming from its persisted cursor after a
restart. It backs off exponentially on 403/429 while the page keeps serving the
last good data.

To enrich one book record from Open Library:

```sh
npm run enrich -- --id <joinId>
```

Enrichment runs once per book record, on first sight. When `npm run index`,
`npm run resample` or the rolling crawler adds a book record to the sample, it is
enriched before its first detail refresh and then never again automatically.
There is no enrichment schedule. Failures are recorded so they can be retried.

To refresh enrichment deliberately, choose one of the bulk targets:

```sh
npm run enrich -- --all        # the whole frozen sample
npm run enrich -- --unmatched  # unmatched or not yet enriched records
npm run enrich -- --failed     # records whose last run failed
```

Bulk runs are sequential and paced by `ENRICH_REQUEST_DELAY_MS` (default one
second, falling back to `LIBIB_REQUEST_DELAY_MS` when set). They print a summary
of enriched, unmatched and failed counts. A bulk refresh never overwrites or
deletes a match override.

To pin a book record to a specific Open Library work, import a CSV with the
columns `join_id,source,source_id_or_url,note`. `source_id_or_url` accepts a
bare work id such as `OL1168083W` or a full Open Library URL. The `note` value
is optional. Invalid rows are reported with their line numbers, and valid rows
are still imported.

```sh
npm run overrides:import -- overrides.csv
```

A match override takes precedence over automatic matching and survives later
enrichment runs.

To get a worklist of book records that have no enrichment or are still
unmatched:

```sh
npm run export:unmatched
npm run export:unmatched -- --out unmatched.csv
```

The CSV always has the columns `join_id,title,author`. Without `--out` it is
printed to stdout.

## Development

One command runs the API on port 3000 and the Vite UI on port 5173:

```sh
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api`, `/health` and `/covers` to
the API.

Environment variables:

| Variable                      | Default  | Meaning                                      |
| ----------------------------- | -------- | -------------------------------------------- |
| `PORT`                        | `3000`   | API port                                     |
| `DATA_DIR`                    | `./data` | SQLite database and cached covers directory  |
| `LIBIB_REQUEST_DELAY_MS`      | `1000`   | Delay between Libib requests (index; detail refresh defaults to `2000`) |
| `ENRICH_REQUEST_DELAY_MS`     | `1000`   | Delay between sequential enrichment requests (falls back to `LIBIB_REQUEST_DELAY_MS`) |
| `CRAWLER_ENABLED`             | `true`   | Run the rolling crawler on server start      |
| `CYCLE_DELAY_SECONDS`         | `30`     | Delay between rolling-crawler book reads     |
| `CRAWLER_MAX_BACKOFF_SECONDS` | `900`    | Upper bound for 403/429 backoff              |
## Scripts

| Script              | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Run API and Vite UI together                      |
| `npm run build`     | Compile the server and build the frontend         |
| `npm start`         | Serve the built app on `PORT`                     |
| `npm run seed`      | Idempotently load fixtures into the database      |
| `npm run index`     | Refresh the frozen 50-book sample from Libib      |
| `npm run resample`  | Re-pick the sample and reconcile stored records   |
| `npm run refresh`   | Refresh circulation and detail for sampled books  |
| `npm run enrich`    | Enrich one book record, or all/unmatched/failed records |
| `npm run overrides:import` | Import match overrides from a CSV          |
| `npm run export:unmatched` | Export unmatched book records as CSV       |
| `npm test`          | Run the test suite                                |
| `npm run typecheck` | Type-check the server and client                  |

## API

- `GET /health` → `{ "status": "ok" }`
- `GET /api/status` → index freshness, crawler cycle progress, backoff and last error
- `GET /api/books?limit=&offset=` → `{ items, total, nextOffset, meta }`
- `GET /api/books/:joinId` → one book, or `404`
- `GET /covers/<file>` → cached cover from `DATA_DIR/covers`
