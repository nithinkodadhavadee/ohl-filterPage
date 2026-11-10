# Operations

This is the reference for running and maintaining the Open House Library
Discovery page. It documents every command, environment variable and data path,
and the lifecycle the service follows in production. [CONTEXT.md](../CONTEXT.md)
defines the vocabulary used here: **Catalogue scan**, **Book sweep**,
**Enrichment pass**, **First run**, **Scheduled catalogue scan**, **Snapshot**,
**Restore**, **Export**, **Crawl set** and **Hidden book**.

## Requirements

- Node 26
- npm

Install dependencies once with `npm ci` (or `npm install`).

## First run

On an empty database the service performs a **First run**:

1. A **Catalogue scan** reads the whole Libib Catalogue index, stores the
   **Crawl set**, caches covers, and enriches newly seen book records.
2. A **Book sweep** starts at the configured pace (one book record every
   `CYCLE_DELAY_SECONDS`, 30 by default).
3. A full **Enrichment pass** runs in parallel with the Book sweep.

There is no faster bootstrap. The first catalogue entries appear within
minutes, and circulation figures fill in over roughly four and a half hours at
the default pace. Scan, sweep and enrichment failures are logged and never stop
the HTTP server; stored data keeps being served throughout.

## Startup catch-up

Every start with a populated database follows the same catch-up sequence:

1. A **Catalogue scan** detects added and removed book records. A book record
   missing from Libib becomes **Hidden**; its rows, enrichment and Match
   override are kept.
2. The normal **Book sweep** resumes from its persisted cursor.
3. A full **Enrichment pass** runs in parallel, covering every visible book
   record, including records that were already enriched.

A full Enrichment pass is skipped when one completed within
`ENRICH_COOLDOWN_SECONDS` (one hour by default). The timestamp is persisted, so
a restart loop cannot repeat third-party traffic.

## Scheduled catalogue scan

The service runs a **Scheduled catalogue scan** every 24 hours by default,
measured from start and configurable with `CATALOGUE_SCAN_INTERVAL_SECONDS`.
Set it to `0` to disable the schedule. A successful scan triggers a full
Enrichment pass. On failure the scan retries with backoff, then waits for the
next run; the Book sweep and stored data are unaffected.

## Commands

All command arguments after `--` are passed through npm to the script. Commands
that touch the database load a `.env` file from the working directory when one
exists.

### `npm run catalogue:scan`

Runs one **Catalogue scan**: reads the full Libib Catalogue index, reconciles the
**Crawl set** with what Libib reports, adds new records, marks missing records
**Hidden**, caches covers and enriches new records on first sight. With
`SAMPLE_SIZE` unset or `0` the Crawl set is the whole visible Collection; a
positive value caps it. Takes a Snapshot on completion.

Arguments: none.

```sh
npm run catalogue:scan
```

### `npm run catalogue:resample`

Re-picks the Crawl set from the current Libib Catalogue index instead of keeping
the frozen one. Use it after the library adds titles, or to restore the sample
count after records disappear. Missing records become Hidden rather than being
deleted. Takes a Snapshot on completion.

Arguments: none.

```sh
npm run catalogue:resample
```

### `npm run sweep`

Runs one full **Book sweep** over the Crawl set: reads each visible book
record's circulation, availability, description, publication data and Libib
tags. Pacing defaults to `CYCLE_DELAY_SECONDS` (30 seconds). It skips records
Libib no longer returns and stops with a clear error on 403 or 429.

Arguments:

| Argument          | Meaning                                                        |
| ----------------- | -------------------------------------------------------------- |
| `--book <joinId>` | Sweep one book record instead of the whole Crawl set.          |
| `--delay <ms>`    | Override the delay between book reads (milliseconds, `0` is allowed). |

```sh
npm run sweep
npm run sweep -- --book 12345
npm run sweep -- --delay 200
npm run sweep -- --book 12345 --delay 0
```

The old `refresh` command was renamed to `sweep`.

### `npm run enrich -- <target>`

Runs an **Enrichment pass** from Open Library. Choose exactly one target:

| Target             | Meaning                                                   |
| ------------------ | --------------------------------------------------------- |
| `--all`            | Every visible book record, including already-enriched ones. |
| `--unmatched`      | Records that are unmatched or have not been enriched yet.  |
| `--failed`         | Records whose last enrichment run failed.                  |
| `--id <joinId>`    | One book record.                                           |

Pacing is `ENRICH_REQUEST_DELAY_MS`, falling back to `LIBIB_REQUEST_DELAY_MS`.
A `--all` pass takes a Snapshot when it completes. Match overrides always win
and are never overwritten.

```sh
npm run enrich -- --id 12345
npm run enrich -- --unmatched
npm run enrich -- --failed
npm run enrich -- --all
```

### `npm run snapshot`

Takes a **Snapshot** of the database immediately and writes it under
`DATA_DIR/snapshots`, then prunes older snapshots to `SNAPSHOT_RETAIN`.

Arguments: none.

```sh
npm run snapshot
```

### `npm run restore -- <path>`

**Restore** replaces the live database with a Snapshot. It refuses to run while
the server is up. The sequence is: stop the server, restore, start the server.

```sh
npm run restore -- data/snapshots/catalogue-2026-11-10T12-00-00-000Z.sqlite
```

### `npm run export -- <path>`

Takes a fresh Snapshot and copies it to `<path>` for off-host backup.

```sh
npm run export -- /backups/catalogue-2026-11-10.sqlite
```

### `npm run overrides:import -- <path>`

Imports **Match overrides** from a CSV with the columns
`join_id,source,source_id_or_url,note`. `source_id_or_url` accepts a bare work id
such as `OL1168083W` or a full Open Library URL; `note` is optional. Invalid
rows are reported with line numbers while valid rows are still imported. Takes
a Snapshot when at least one override is written.

```sh
npm run overrides:import -- overrides.csv
```

### `npm run export:unmatched [-- --out <path>]`

Exports the worklist of book records with no enrichment or an unmatched result.
The CSV columns are always `join_id,title,author`. Without `--out` it prints to
stdout.

```sh
npm run export:unmatched
npm run export:unmatched -- --out unmatched.csv
```

### `npm run seed`

Loads the committed fixtures into the database and copies their covers. It is
idempotent and never contacts Libib. Use it to build the page without scraping.

```sh
npm run seed
```

### `npm run dev`

Runs the API and the Vite UI together. The API listens on `PORT` (3000) and the
UI on <http://localhost:5173>, proxying `/api`, `/health` and `/covers` to the
API.

### `npm run build`

Compiles the server and builds the frontend into `dist/`.

### `npm start`

Serves the built app on `PORT`. It binds to `127.0.0.1`; the deployment shape
puts a tunnel in front of it.

### `npm test`

Runs the Vitest suite.

### `npm run typecheck`

Type-checks the server and client.

### Renamed commands

The pre-Pass 3 names are removed, not aliased: `index` became
`catalogue:scan`, `resample` became `catalogue:resample`, and `refresh` became
`sweep`.

## Environment variables

| Variable                          | Default                                   | Meaning                                                                 |
| --------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `PORT`                            | `3000`                                    | HTTP port.                                                              |
| `DATA_DIR`                        | `./data`                                  | Directory holding the database, covers, snapshots and server lock.      |
| `SAMPLE_SIZE`                     | `0` (whole visible Collection)            | Caps the Crawl set to the first N titles from A onward. Local sample: `50`. |
| `CYCLE_DELAY_SECONDS`             | `30`                                      | Delay between Book sweep reads; also the default pacing for `sweep`.    |
| `CRAWLER_ENABLED`                 | `true`                                    | Run the startup Catalogue scan, Book sweep and enrichment catch-up.     |
| `ENRICH_COOLDOWN_SECONDS`         | `3600`                                    | Skip a startup Enrichment pass completed within this window.            |
| `CATALOGUE_SCAN_INTERVAL_SECONDS` | `86400`                                   | Scheduled catalogue scan interval; `0` disables it.                     |
| `SNAPSHOT_RETAIN`                 | `10`                                      | Number of recent snapshots kept after a Snapshot.                       |
| `CRAWLER_MAX_BACKOFF_SECONDS`     | `900`                                     | Upper bound for 403/429 backoff.                                        |
| `LIBIB_REQUEST_DELAY_MS`          | `1000` (detail fallback `2000`)           | Delay between Libib index requests; also the fallback for enrichment and detail pacing. |
| `ENRICH_REQUEST_DELAY_MS`         | `1000`                                    | Delay between enrichment requests; falls back to `LIBIB_REQUEST_DELAY_MS`. |
| `LIBIB_BASE_URL`                  | `https://www.libib.com/u/openhouselibrary` | Override the Libib library base URL.                                    |
| `LIBIB_LIBRARY_ID`                | `2677037`                                 | Override the Libib library id used by the Catalogue scan.               |

## Local 50-book sample

Local development works against the first 50 titles from A onward. Copy the
committed example and leave it git-ignored:

```sh
cp .env.example .env
```

`.env.example` sets `SAMPLE_SIZE=50`. The `dev` and CLI scripts load `.env` with
Node's `--env-file-if-exists`, so no shell export is needed. Production leaves
`SAMPLE_SIZE` unset (or `0`) to use the whole visible Collection.

## Data layout

Everything lives under `DATA_DIR` (default `./data`), which is the directory to
bind-mount and back up:

```
data/
  catalogue.sqlite          SQLite database (book records, enrichment, overrides, crawl state)
  catalogue.sqlite-wal      SQLite write-ahead log, when present
  catalogue.sqlite-shm      SQLite shared-memory file, when present
  covers/                   Cached cover images, named <joinId>-<hash>.<ext>
  snapshots/                Snapshots named catalogue-<timestamp>.sqlite
  server.lock               PID of the running server; used to refuse double starts and live restores
```

Covers are re-fetchable and therefore excluded from Snapshots. Snapshots contain
the database only, including enrichments and Match overrides.

## Snapshot, Restore and Export

- A **Snapshot** is a consistent copy of the SQLite database. Automatic
  Snapshots are taken after a Catalogue scan, after a full Enrichment pass,
  after a Match override import, and on demand with `npm run snapshot`.
- **Restore** replaces the live database from a Snapshot. Stop the server first,
  restore, then start again:

  ```sh
  npm run restore -- data/snapshots/catalogue-2026-11-10T12-00-00-000Z.sqlite
  npm start
  ```

- **Export** copies a fresh Snapshot off-host with `npm run export -- <path>`.

Recent circulation can be lost on Restore; it is cheap to sweep again. Hidden
books, enrichments and Match overrides survive a Restore.

## Health and status

- `GET /health` returns `{ "status": "ok" }`.
- `GET /api/status` reports catalogue freshness, Book sweep progress, backoff,
  the last error and startup scan/enrichment progress.

## Deployment

Containerisation and hosting (Docker/Compose and the host-run Cloudflare Tunnel)
are covered by ticket 25. This document describes the process-level commands and
configuration that the deployment wraps.
