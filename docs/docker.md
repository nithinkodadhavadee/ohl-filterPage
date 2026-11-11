# Docker and deployment guide

Everything needed to run the discovery page as a container, move the catalogue
between machines, and expose it through Tailscale Funnel. For commands,
environment variables and lifecycle details, see
[operations.md](operations.md). For the process and ticket workflow, see
[ai-workflow.md](ai-workflow.md).

## Requirements

- Docker Engine or Docker Desktop.
- Docker Compose v2 (`docker compose`, not `docker-compose`).
- No Node installation is needed for the container; Node 26 is only required for
  local development and tests.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage Node 26 build; runs the server directly as PID 1. |
| `docker-compose.yml` | Single `app` service, bind mount, env, healthcheck. |
| `.dockerignore` | Keeps data, tests, docs, `.env` and `node_modules` out of the image. |
| `.env.example` | Environment template. No secrets. |
| `docs/operations.md` | All commands, env vars and data paths. |

The image contains the application and fixtures only. The catalogue database,
cached covers and Snapshots live on the host bind mount; the image carries **no
catalogue data**.

## Environment files

Compose reads `.env` in this directory for `${VARIABLE}` substitution.

- `.env` — used by Compose and the container. Keep it out of git. Put `DATA_DIR`
  and anything you deliberately override here. Keep `SAMPLE_SIZE=0` or omit it so
  production covers the whole visible Collection.
- `.env.local` — local development only; loaded by `npm run dev` and the CLI
  scripts, never by Compose.
- `.env.example` — template, safe to commit.

Create `.env` on the server:

```sh
DATA_DIR=/srv/open-house-library/data
# Do not set SAMPLE_SIZE unless you intend to cap the catalogue.
```

## Quick start

```sh
mkdir -p data
cp .env.example .env            # then set DATA_DIR if needed
docker compose up -d --build
docker compose ps               # wait for (healthy)
docker compose logs -f app
curl -s http://127.0.0.1:3000/health
```

Open <http://127.0.0.1:3000> and <http://127.0.0.1:3000/status>.

The first build can take a few minutes. There is no `down` needed before an
upgrade; `up -d --build` rebuilds the image, gracefully stops and recreates the
container, and leaves the bind-mounted data alone.

## Data layout

Inside the container everything lives under `/data`:

```
/data/catalogue.sqlite     SQLite database
/data/covers/              cached cover images
/data/snapshots/           consistent database Snapshots
/data/server.lock          heartbeat lock; do not copy between hosts
```

`DATA_DIR` selects the **host** directory. The Compose default is
`${DATA_DIR:-./data}`. The container runs as UID/GID `10001`; on Linux the host
directory must be writable by that user:

```sh
sudo mkdir -p /srv/open-house-library/data
sudo chown -R 10001:10001 /srv/open-house-library/data
```

Docker Desktop on macOS shares the path automatically; if you hit permission
errors in a local test, `chmod -R a+rwX data` is fine for that test only.

## Lifecycle

- **Empty data directory:** First run. A Catalogue scan, then the Book sweep and
  a full Enrichment pass in parallel. The site answers as soon as the server is
  up; records fill in.
- **Populated data directory:** serves stored data immediately, then runs the
  startup catch-up: Catalogue scan, Enrichment pass (subject to the one-hour
  cooldown) and the resumed Book sweep.
- A book removed from Libib becomes **Hidden** at the next Catalogue scan.
- The Catalogue scan runs on startup and then daily
  (`CATALOGUE_SCAN_INTERVAL_SECONDS`, default 86400). Set `0` to disable the
  timer.

## Common commands

| Command | What it does |
| --- | --- |
| `docker compose up -d --build` | Build and run/recreate the container |
| `docker compose up -d` | Start without rebuilding |
| `docker compose stop` | Graceful stop (SIGTERM, lock released) |
| `docker compose start` | Start the existing container again |
| `docker compose down` | Stop and remove the container (data survives) |
| `docker compose ps` | Container state and health |
| `docker compose logs -f app` | Follow logs |
| `docker compose exec app <command>` | Run a command in the running container |
| `docker compose run --rm app <command>` | One-off container, same image/volume |
| `docker compose config` | Render the resolved Compose configuration |
| `docker compose config --quiet` | Validate the compose file |

Do not use `docker compose down -v` if you add named volumes later; today the
data is a host bind mount, so `down` never deletes it.

## Maintenance commands inside the container

```sh
docker compose exec app npm run catalogue:scan
docker compose exec app npm run sweep
docker compose exec app npm run sweep -- --book 167806440
docker compose exec app npm run sweep -- --delay 2000
docker compose exec app npm run enrich -- --all
docker compose exec app npm run enrich -- --unmatched
docker compose exec app npm run enrich -- --failed
docker compose exec app npm run enrich -- --id 167806440
docker compose exec app npm run overrides:import -- /data/overrides.csv
docker compose exec app npm run export:unmatched -- --out /data/unmatched.csv
docker compose exec app npm run snapshot
docker compose exec app npm run export -- /data/export.sqlite
```

Paths are **inside** the container. Use a path under `/data` when the file should
appear on the host (for example `/data/overrides.csv` becomes
`$DATA_DIR/overrides.csv`).

## Snapshots, backup and restore

A Snapshot is a consistent copy of `catalogue.sqlite`, not a dump. Take one
before moving hosts or before risky work:

```sh
docker compose exec app npm run snapshot
ls -lt "$DATA_DIR/snapshots" | head
```

Automatic Snapshots are taken after a Catalogue scan, after a full Enrichment
pass, after an Override import, and on demand. The last 10 are kept
(`SNAPSHOT_RETAIN`). Cached covers are not included.

Restore requires the server to be stopped:

```sh
docker compose stop
docker compose run --rm app npm run restore -- /data/snapshots/<file>.sqlite
docker compose start
```

Export a Snapshot off-host:

```sh
docker compose exec app npm run export -- /data/export.sqlite
cp "$DATA_DIR/export.sqlite" /some/offsite/location/
```

To export an existing Snapshot rather than a fresh one:

```sh
docker compose exec app npm run export -- /data/snapshots/<file>.sqlite /data/export.sqlite
```

## Moving the catalogue to another machine

The database is not in git and not in the image. Copy a Snapshot plus covers:

```sh
# 1. take a Snapshot on the old host
docker compose exec app npm run snapshot

# 2. stop the old container so two crawlers do not run
docker compose stop

# 3. copy the Snapshot as the new database, and the covers
scp "$DATA_DIR/snapshots/<latest>.sqlite" new-host:/srv/open-house-library/data/catalogue.sqlite
rsync -a "$DATA_DIR/covers/" new-host:/srv/open-house-library/data/covers/

# 4. on the new host, fix ownership, start, and check health
sudo chown -R 10001:10001 /srv/open-house-library/data
docker compose up -d --build
curl -s http://127.0.0.1:3000/health
```

Do not copy `server.lock`. If covers are omitted, the first Catalogue scan
re-downloads missing files.

## Exposing the site

### Tailscale Funnel (public)

The container publishes plain HTTP on `127.0.0.1:3000`, which is exactly what a
host-run Tailscale instance needs.

```sh
sudo tailscale funnel --bg 3000
tailscale funnel status
```

Funnel serves HTTPS on `https://<machine>.<tailnet>.ts.net/` and proxies to
`http://127.0.0.1:3000`. Tailscale terminates TLS; the container never handles
certificates.

- Funnel must be enabled for the tailnet, and HTTPS certificates must be enabled.
- **Funnel is public internet**, not tailnet-only. This site is read-only and has
  no auth.
- For tailnet-only access, use `sudo tailscale serve --bg 3000` instead of
  `tailscale funnel`.
- Stop sharing with `sudo tailscale funnel --bg off` (or `tailscale funnel reset`).

### Cloudflare Tunnel (later)

A single host-run `cloudflared` can serve several projects. Point a hostname at
`http://localhost:3000` with an ingress rule. Do not run a per-project
cloudflared container. See the Cloudflare section in
[operations.md](operations.md#cloudflare-tunnel-ingress).

## Healthcheck

The image and Compose healthcheck call `GET /health` with Node's `fetch` and fail
unless the body reports `status: "ok"`. The body covers the database, crawler,
startup and Scheduled catalogue scan. Normal Libib backoff does not fail the
check; a hard database or crawler error does.

```sh
docker compose ps
curl -s http://127.0.0.1:3000/health
```

## Troubleshooting

- **Port 3000 already in use:** stop the local dev server or change both sides
  of `ports` and `PORT`.
- **Permission denied writing `/data`:** on Linux,
  `sudo chown -R 10001:10001 "$DATA_DIR"`. On macOS, use a shared path such as
  under your home directory.
- **Unhealthy container:** `docker compose logs app`; check `/health` and
  `/status`. A first Catalogue scan or Enrichment pass can take time.
- **No covers:** copy `covers/` or let the next Catalogue scan re-download them.
- **The site is stale:** check `/status` for the last Catalogue scan and Book
  sweep; both have their own cadence.
- **Copy-link button does nothing over HTTP:** `navigator.clipboard` requires a
  secure context. Use HTTPS (Funnel) or localhost.
- **Rebuild did not pick up a change:** `docker compose up -d --build`; `restart`
  alone does not rebuild the image.
- **Compose reads the wrong SAMPLE_SIZE:** Compose reads `.env`, not
  `.env.local`. Keep `SAMPLE_SIZE=0` or omit it there.

## Local LAN testing

The committed Compose file publishes on loopback only. To test from a phone on
the same Wi-Fi, create a git-ignored `docker-compose.override.yml`:

```yaml
services:
  app:
    ports: !override
      - "0.0.0.0:3000:3000"
```

Then `docker compose up -d`. Do not deploy that override to the server; Funnel
and Cloudflare use the loopback publication.
