# Open House Library Discovery

A read-only discovery page over the Open House Library's Libib catalogue. It
serves a searchable, filterable grid and table of book records, with circulation
figures refreshed by a polite rolling sweep and Ratings, Subjects and page count
from Open Library.

The full command reference, environment variables, data layout and lifecycle
are in [docs/operations.md](docs/operations.md). [CONTEXT.md](CONTEXT.md) defines
the project vocabulary.

## Requirements

- Node 26
- npm

## Setup

```sh
npm ci
cp .env.example .env   # local sample: SAMPLE_SIZE=50
npm run seed
```

The seed command writes fixtures into `DATA_DIR` (default `./data`) and never
contacts Libib. `.env` is git-ignored; the `dev` and CLI scripts load it when
present. Production leaves `SAMPLE_SIZE` unset (or `0`) to use the whole visible
Collection.

## Commands

| Script                     | What it does                                             |
| -------------------------- | -------------------------------------------------------- |
| `npm run catalogue:scan`   | Read the Libib Catalogue index and reconcile the Crawl set |
| `npm run catalogue:resample` | Re-pick the Crawl set and reconcile stored records     |
| `npm run sweep`            | Run one Book sweep; `--book <joinId>` and `--delay <ms>` |
| `npm run enrich -- <target>` | Enrich `--all`, `--unmatched`, `--failed` or `--id <joinId>` |
| `npm run snapshot`         | Write a Snapshot under `DATA_DIR/snapshots`              |
| `npm run restore -- <path>` | Restore the database from a Snapshot (server stopped)   |
| `npm run export -- <path>` | Export a Snapshot off-host                               |
| `npm run overrides:import -- <path>` | Import Match overrides from a CSV              |
| `npm run export:unmatched` | Export unmatched book records as CSV                     |
| `npm run seed`             | Idempotently load fixtures into the database             |
| `npm run dev`              | Run the API and Vite UI together                         |
| `npm run build`            | Compile the server and build the frontend                |
| `npm start`                | Serve the built app on `PORT`                            |
| `npm test`                 | Run the test suite                                       |
| `npm run typecheck`        | Type-check the server and client                         |

The old `index`, `resample` and `refresh` script names are removed; use
`catalogue:scan`, `catalogue:resample` and `sweep`.

## Deployment

The whole app runs as one container with the database, covers and snapshots on a
host bind mount at `/data`. The container publishes plain HTTP on
`127.0.0.1:3000`; a host-run Cloudflare Tunnel provides TLS and public routing.
Start it with `docker compose up -d --build`. The full build, volume-permission,
backup, restore, upgrade and tunnel instructions are in the
[deployment section of the operations documentation](docs/operations.md#deployment).

## Development

One command runs the API on port 3000 and the Vite UI on port 5173:

```sh
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api`, `/health` and `/covers` to
the API.

## API

- `GET /health` → `{ "status": "ok" }`
- `GET /api/status` → catalogue freshness, sweep progress, backoff, last error and startup progress
- `GET /api/books?limit=&offset=` → `{ books, total, nextOffset, meta }`
- `GET /api/books/:joinId` → one book, or `404`
- `GET /api/facets` → `{ tags, authors, subjects }` with counts
- `GET /covers/<file>` → cached cover from `DATA_DIR/covers`
