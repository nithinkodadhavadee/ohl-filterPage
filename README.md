# Open House Library Discovery

A read-only, searchable discovery page for the Open House Library's
[Libib catalogue](https://www.libib.com/u/openhouselibrary). It presents the
collection as a cover grid or a dense table, with filters and search over
Subjects, authors, Ratings, Holds, availability, page count and Libib tags.

Live circulation figures (Copies, Out, Holds) come from a polite rolling sweep of
the public Libib catalogue. Ratings, Subjects and page count come from
[Open Library](https://openlibrary.org). Nothing is written back to Libib;
borrowing and Holds stay there.

## Features

- Cover grid and table views, infinite scroll, mobile-first.
- Free-text search with typo tolerance.
- Filters: Subjects, authors, Libib tags, Holds buckets, availability, minimum
  Rating (with low-sample control), page-count range and unmatched books.
- Book detail view with circulation, publication data, description, Subjects,
  Rating and its sample size, and a link to the matched Open Library record.
- A public, read-only `/status` page with run history for Catalogue scans,
  Enrichment passes, Book sweeps, Snapshots, Restore, Export and Override imports.
- Optional Match overrides for books Open Library matches poorly.

## Stack

- Node 26, TypeScript, Fastify, built-in `node:sqlite`, React + Vite.
- One Docker image; SQLite database, cached covers and Snapshots live on a host
  bind mount at `/data`.
- No authentication and no write endpoints. The public site is read-only.

## Quick start

### Local development

Requirements: **Node 26** and npm.

```sh
npm ci
cp .env.example .env.local      # then set SAMPLE_SIZE=50 in .env.local
npm run dev
```

The API listens on <http://localhost:3000>; Vite serves the UI on
<http://localhost:5173> and proxies `/api`, `/health` and `/covers`.

To see data without contacting Libib:

```sh
npm run seed                    # loads fixtures into DATA_DIR (default ./data)
```

To use the live catalogue locally:

```sh
npm run catalogue:scan          # read the Libib index
npm run sweep                   # one Book sweep (about 30s per book)
npm run enrich -- --all         # Open Library enrichment
```

`.env.local` is git-ignored; development scripts load `.env` first and then
`.env.local`. Compose reads only `.env`.

### Docker

```sh
mkdir -p data
cp .env.example .env            # keep SAMPLE_SIZE=0 (whole catalogue)
# optional: set DATA_DIR to an absolute host path in .env
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:3000/health
```

Open <http://localhost:3000>; the status page is at `/status`. The full Docker
guide, including data migration, Snapshots, Restore and Tailscale Funnel, is in
[docs/docker.md](docs/docker.md).

## Commands

The complete reference is [docs/operations.md](docs/operations.md). The main
entry points:

| Command | Purpose |
| --- | --- |
| `npm run catalogue:scan` | Reconcile the Crawl set with the Libib index |
| `npm run catalogue:resample` | Re-pick a capped Sample (development) |
| `npm run sweep` | One Book sweep; `--book <joinId>`, `--delay <ms>` |
| `npm run enrich -- <target>` | `--all`, `--unmatched`, `--failed` or `--id <joinId>` |
| `npm run snapshot` | Write a consistent database Snapshot |
| `npm run restore -- <path>` | Restore (server stopped) |
| `npm run export -- <destination>` | Copy a Snapshot off-host |
| `npm run overrides:import -- <csv>` | Import Match overrides |
| `npm run export:unmatched` | CSV of unmatched book records |
| `npm run dev` / `build` / `start` | Development, build, serve |
| `npm test` / `typecheck` | Tests and type checking |

## Configuration

Every environment variable and default is documented in
[docs/operations.md](docs/operations.md). The important ones:

- `DATA_DIR` — host path for the database, covers and snapshots (default `./data`).
- `SAMPLE_SIZE` — `0` or unset means the whole Collection; a positive value caps
  the Crawl set. Local development uses 50; production leaves it at `0`.
- `CYCLE_DELAY_SECONDS` — Book sweep pacing (default 30).
- `CATALOGUE_SCAN_INTERVAL_SECONDS` — Scheduled catalogue scan (default 86400).
- `ENRICH_COOLDOWN_SECONDS` — startup Enrichment pass cooldown (default 3600).

There are no secrets in the repository. `.env` and `.env.local` are git-ignored;
`.env.example` is the template.

## Project documentation

| Document | What it holds |
| --- | --- |
| [CONTEXT.md](CONTEXT.md) | Domain glossary. Use this vocabulary. |
| [docs/adr/](docs/adr/) | Durable architectural decisions. |
| [.scratch/catalogue-discovery/spec.md](.scratch/catalogue-discovery/spec.md) | Product spec / decision record. |
| [.scratch/catalogue-discovery/issues/](.scratch/catalogue-discovery/issues/) | Tickets with status, blockers and acceptance criteria. |
| [.scratch/catalogue-discovery/STATUS.md](.scratch/catalogue-discovery/STATUS.md) | Done versus pending, per pass. |
| [.scratch/catalogue-discovery/BACKLOG.md](.scratch/catalogue-discovery/BACKLOG.md) | Unscheduled ideas (not tickets). |
| [docs/operations.md](docs/operations.md) | Commands, environment, lifecycle. |
| [docs/docker.md](docs/docker.md) | Docker, deployment, data migration, Funnel. |
| [docs/ai-workflow.md](docs/ai-workflow.md) | How the passes, tickets and documentation fit together. |
| [docs/agents/](docs/agents/) | Issue tracker, triage labels and domain-doc rules. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local setup, tests, workflow and PR checklist. |

## Data sources and operating notes

- Libib's public catalogue is scraped without an API key. Its `robots.txt`
  disallows the public profile path and sets a crawl delay; the Book sweep paces
  itself accordingly (one book every 30 seconds by default).
- A full Book sweep over roughly 600 books takes about five hours of active
  crawling. The page serves stored data throughout, with per-book refreshed
  timestamps.
- The Catalogue scan runs on startup and daily by default. A book removed from
  Libib becomes **Hidden** at the next scan.
- Libib exposes no ISBN, so enrichment matches on title and author. Poor matches
  can be pinned with a Match override. Enrichment is refreshed on startup and
  daily, not on every sweep.
- Open Library Ratings are sparse; the page always shows sample size and flags
  low-sample Ratings.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for local setup, tests, code style and
the ticket workflow. AI-assisted work follows
[docs/ai-workflow.md](docs/ai-workflow.md).

## Status

- Product spec: [.scratch/catalogue-discovery/spec.md](.scratch/catalogue-discovery/spec.md)
- Done and pending: [STATUS.md](.scratch/catalogue-discovery/STATUS.md)
- Unscheduled ideas: [BACKLOG.md](.scratch/catalogue-discovery/BACKLOG.md)
