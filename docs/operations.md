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

First run uses the normal pace; there is no faster start. The first catalogue
entries appear within minutes, and circulation figures fill in over roughly
four and a half hours at the default pace. Scan, sweep and enrichment failures are logged and never stop
the HTTP server; stored data keeps being served throughout.

## Startup catch-up

Every start with a populated database follows the same catch-up sequence:

1. A **Catalogue scan** detects added and removed book records. A book record
   absent from the full Libib index becomes **Hidden**; its rows, enrichment and
   Match override are kept. A record still in Libib but outside a capped Sample
   is retained rather than hidden.
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
that touch the database load `.env` and then `.env.local` from the working
directory when they exist, so local development settings override shared ones.

### `npm run catalogue:scan`

Runs one **Catalogue scan**: reads the full Libib Catalogue index, reconciles the
**Crawl set** with what Libib reports, adds new records, marks records absent
from Libib **Hidden**, caches covers and enriches new records on first sight. With
`SAMPLE_SIZE` unset or `0` the Crawl set is the whole visible Collection; a
positive value caps the Sample. The Sample limit decides what is stored and
refreshed, not what is hidden: a stored record is Hidden only when it is absent
from the full Libib index. Takes a Snapshot on completion.

Arguments: none.

```sh
npm run catalogue:scan
```

### `npm run catalogue:resample`

Re-picks the Sample from the current Libib Catalogue index instead of keeping
the frozen one. Use it after the library adds titles, or to re-pick the Sample
after records disappear. Records genuinely absent from Libib become Hidden;
records still in Libib but outside the new Sample are kept. Switching sample
sizes may therefore retain earlier stored records; resetting the database starts
clean. Takes a Snapshot on completion.

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

### `npm run export -- <destination>` or `npm run export -- <snapshot> <destination>`

With one path, takes a fresh Snapshot and copies it to `<destination>` for
off-host storage. With two paths, copies the chosen existing Snapshot instead.
If the Snapshot is not found the command fails.

```sh
npm run export -- /offsite/catalogue-2026-11-10.sqlite
npm run export -- data/snapshots/catalogue-2026-11-10T12-00-00-000Z.sqlite /offsite/catalogue-2026-11-10.sqlite
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

Serves the built app on `PORT`, binding to `HOST` (`127.0.0.1` by default). The
deployment shape sets `HOST=0.0.0.0` inside the container and publishes only the
loopback port on the host.

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
| `HOST`                            | `127.0.0.1`                               | Address the HTTP server binds to. The container sets `0.0.0.0`.          |
| `PORT`                            | `3000`                                    | HTTP port.                                                              |
| `DATA_DIR`                        | `./data`                                  | Directory holding the database, covers, snapshots and server lock.      |
| `SAMPLE_SIZE`                     | `0` (whole visible Collection)            | Caps the Sample to the first N titles from A onward. Set `50` in `.env.local` for local development. |
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

## Local 50-book Sample

Local development works against the first 50 titles from A onward. Put local
configuration in `.env.local`, which is git-ignored and is loaded by `npm run
dev` and every CLI script after `.env`:

```sh
cp .env.example .env.local
# then set SAMPLE_SIZE=50 in .env.local
```

`.env.example` documents both modes and keeps `SAMPLE_SIZE=0` so that copying it
to `.env` for Docker Compose never caps production. Compose reads `.env`, never
`.env.local`. Production leaves `SAMPLE_SIZE` unset (or `0`) to use the whole
visible Collection.

## Data layout

Everything lives under `DATA_DIR` (default `./data`), which is the directory to
bind-mount and Snapshot:

```
data/
  catalogue.sqlite          SQLite database (book records, enrichment, overrides, crawl state)
  catalogue.sqlite-wal      SQLite write-ahead log, when present
  catalogue.sqlite-shm      SQLite shared-memory file, when present
  covers/                   Cached cover images, named <joinId>-<hash>.<ext>
  snapshots/                Snapshots named catalogue-<timestamp>.sqlite
  server.lock               Server heartbeat (with PID for diagnostics); used to refuse double starts and live restores
```

Covers are re-fetchable and therefore excluded from Snapshots. Snapshots contain
the database only, including enrichments and Match overrides.

## Snapshot, Restore and Export

- A **Snapshot** is a consistent copy of the SQLite database. Automatic
  Snapshots are taken after a Catalogue scan, after a full Enrichment pass,
  after a Match override import, and on demand with `npm run snapshot`.
- **Restore** replaces the live database from a Snapshot. Stop the server first,
  restore, then start again. Restore refuses while the server heartbeat is fresh
  (written every 10 seconds and considered fresh for 30 seconds); a stale lock is
  cleaned automatically. The PID in the lock is kept for diagnostics.

  ```sh
  npm run restore -- data/snapshots/catalogue-2026-11-10T12-00-00-000Z.sqlite
  npm start
  ```

- **Export** copies a fresh Snapshot off-host with `npm run export --
  <destination>`, or copies a chosen existing Snapshot with `npm run export --
  <snapshot> <destination>`.

Recent circulation can be lost on Restore; it is cheap to sweep again. Hidden
books, enrichments and Match overrides survive a Restore.

## Health and status

- `GET /health` returns `{ status, database, crawler, startup, scheduled }`.
  `status` is `ok` or `degraded`, and the endpoint answers `503` when the
  database cannot be read or the crawler is in a hard error state. Normal
  throttling backoff stays `ok`. The Docker healthcheck parses this body and
  fails on anything other than `status: "ok"`.
- `GET /api/status` reports catalogue freshness, Book sweep progress, backoff,
  the last error, startup scan/enrichment progress and the Scheduled catalogue
  scan state.

## Deployment

The service runs as one container. The image carries the application and the
development fixtures needed by `seed`, but no catalogue database, cached covers
or snapshots; those live in a host directory bind-mounted at `/data`. The
container serves plain HTTP on a loopback-published port. TLS and public routing
belong to a host-run Cloudflare Tunnel, never to the container.

### Build and run with Docker

```sh
docker build -t open-house-library-discovery .
mkdir -p data
sudo chown -R 10001:10001 data
docker run -d \
  --name open-house-library-discovery \
  --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -v "$PWD/data:/data" \
  -e HOST=0.0.0.0 \
  open-house-library-discovery
```

The image runs as fixed UID/GID `10001`. On Linux the bind-mounted host
directory must be writable by that UID; the `chown` above prepares it. On Docker
Desktop for macOS the mount is shared automatically. `HOST=0.0.0.0` is required
inside the container so the published port can reach the process; the host
publication stays on `127.0.0.1`.

### Docker Compose

The committed `docker-compose.yml` runs the single `app` service:

```sh
mkdir -p data
sudo chown -R 10001:10001 data
docker compose up -d --build
docker compose ps
docker compose logs -f app
curl http://127.0.0.1:3000/health
```

It publishes `127.0.0.1:3000:3000`, binds `${DATA_DIR:-./data}` to `/data`, sets
`restart: unless-stopped`, and passes every operational environment variable
through with a default. Stopping the container or replacing the image keeps the
volume; deleting `data/` or the `DATA_DIR` directory is the only way to lose
catalogue state.

The container runs Node directly, so it is PID 1 and receives Docker's stop
signal itself. On `docker compose stop` the server logs `Received SIGTERM,
shutting down`, aborts the Scheduled catalogue scan, Startup tasks and Book
sweep, closes the database, removes `server.lock` and exits 0. An in-flight
Catalogue scan is abandoned rather than awaited; records it already committed
stay in the database, and the next start resumes the normal startup catch-up.
If closing or stopping a task fails the error is logged, the lock is still
removed and the process still exits 0. A second signal during shutdown does not
start another close. `docker compose start` then reuses the same volume and
resumes from the persisted crawl cursor.

### Environment injection

Compose substitutes `${VARIABLE}` from the shell or from a `.env` file next to
`docker-compose.yml` before the container starts. Those values become the
container's environment when it is created; changing `.env` requires
`docker compose up -d` to recreate the container. The running container does not
mount the repository `.env`, and the image does not contain one. `.env.local` is
for local development only and is never read by Compose. Inside the container
the application always sees `DATA_DIR=/data`; the host-side `DATA_DIR` only
chooses the bind-mount source.

`SAMPLE_SIZE` defaults to `0` (the whole visible Collection) in Compose. Keep it
out of `.env` unless you deliberately want a capped Crawl set in production.

`PORT` is fixed at `3000` inside the container and in the published mapping. To
move it, change both sides of `ports` and keep them equal.

### First run and catch-up

With an empty volume the service performs the normal **First run**: a Catalogue
scan, then the Book sweep and a full Enrichment pass in parallel. `/health`
answers as soon as the HTTP server is up; book records appear progressively.

With a populated volume the service serves stored data immediately and performs
the startup catch-up in the background: a Catalogue scan, then the Book sweep
and an Enrichment pass. A full Enrichment pass is skipped when one completed
within `ENRICH_COOLDOWN_SECONDS`.

The image also carries the development fixture seed command. It is useful for a
throwaway volume, not for production data:

```sh
docker compose exec app npm run seed
```

Run `docker compose exec app npm run catalogue:scan` instead when the volume
already holds production data.

### CLI commands inside the container

The image ships the compiled server and every CLI entry point. The same npm
script names used on the host work inside the container; the scripts run the
compiled files when `tsx` is absent, and the TypeScript sources through `tsx`
during local development:

```sh
docker compose exec app npm run snapshot
docker compose exec app npm run sweep -- --book 12345
docker compose exec app npm run enrich -- --unmatched
docker compose exec app npm run export -- /data/exports/catalogue.sqlite
```

`docker compose exec` uses the environment of the running container, not the
host `.env`. Paths given to `restore`, `export`, `overrides:import` and
`export:unmatched` are inside the container; use a path under `/data` for files
that should appear on the host.

### Healthcheck

The image and Compose define a healthcheck that calls `GET /health` with Node's
`fetch` (no `curl` is installed) and fails unless the body reports
`status: "ok"`. It runs every 30 seconds with a 5-second timeout, a 30-second
start period and three retries. `docker compose ps` shows the result. The body
covers the database, crawler, startup and Scheduled catalogue scan status.
Normal backoff for Libib throttling does not fail the check; a hard crawler
error does.

### Snapshot off-host and restore

Take a Snapshot and copy it off the volume:

```sh
docker compose exec app npm run snapshot
cp data/snapshots/catalogue-2026-11-10T12-00-00-000Z.sqlite /offsite/
```

Or export directly to a path under the bind mount and copy that:

```sh
docker compose exec app npm run export -- /data/exports/catalogue-2026-11-10.sqlite
cp data/exports/catalogue-2026-11-10.sqlite /offsite/
```

To move an existing Snapshot instead of taking a fresh one, pass both paths:

```sh
docker compose run --rm --no-deps app npm run export -- /data/snapshots/catalogue-2026-11-10T12-00-00-000Z.sqlite /data/exports/catalogue-2026-11-10.sqlite
```

Snapshots contain the database only. Copy `data/covers/` separately if an
off-host copy of the cached cover images is wanted; they are re-fetchable.

Restore replaces the database and must run with the server stopped. `docker
compose run` starts a separate one-off container against the same volume:

```sh
docker compose stop app
docker compose run --rm --no-deps app npm run restore -- /data/snapshots/catalogue-2026-11-10T12-00-00-000Z.sqlite
docker compose start app
```

The restore command removes stale SQLite `-wal` and `-shm` files and refuses to
run while the server heartbeat is fresh. Recent circulation can be lost on
Restore; it is cheap to sweep again. Hidden books, enrichments and Match
overrides survive.

### Upgrade and rollback

Take a Snapshot, then rebuild and recreate the container. The data volume is
untouched:

```sh
docker compose exec app npm run snapshot
git pull
docker compose build
docker compose up -d
```

To roll back, check out the previous revision, rebuild and recreate the same way.
If a release requires a data change, restore the Snapshot taken before the
upgrade.

### Cloudflare Tunnel ingress

Run one `cloudflared` process on the host, shared by every project. Point the
site's hostname at the loopback publication:

```yaml
tunnel: 00000000-0000-0000-0000-000000000000
credentials-file: /etc/cloudflared/00000000-0000-0000-0000-000000000000.json

ingress:
  - hostname: catalogue.example.org
    service: http://localhost:3000
  - service: http_status:404
```

Create the DNS route once with
`cloudflared tunnel route dns <tunnel-name> catalogue.example.org`, then run
`cloudflared tunnel run <tunnel-name>`. Cloudflare terminates TLS, so neither
the image nor Compose handles certificates. Because the published port is bound
to `127.0.0.1`, the origin is reachable only through the tunnel.
