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

## Development

One command runs the API on port 3000 and the Vite UI on port 5173:

```sh
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api`, `/health` and `/covers` to
the API.

Environment variables:

| Variable                 | Default  | Meaning                                      |
| ------------------------ | -------- | -------------------------------------------- |
| `PORT`                   | `3000`   | API port                                     |
| `DATA_DIR`               | `./data` | SQLite database and cached covers directory  |
| `LIBIB_REQUEST_DELAY_MS` | `1000`   | Delay between Libib index requests           |

## Scripts

| Script              | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Run API and Vite UI together                      |
| `npm run build`     | Compile the server and build the frontend         |
| `npm start`         | Serve the built app on `PORT`                     |
| `npm run seed`      | Idempotently load fixtures into the database      |
| `npm run index`     | Refresh the frozen 50-book sample from Libib      |
| `npm run resample`  | Re-pick the sample and reconcile stored records   |
| `npm test`          | Run the test suite                                |
| `npm run typecheck` | Type-check the server and client                  |

## API

- `GET /health` → `{ "status": "ok" }`
- `GET /api/books?limit=&offset=` → `{ items, total, nextOffset, meta }`
- `GET /api/books/:joinId` → one book, or `404`
- `GET /covers/<file>` → cached cover from `DATA_DIR/covers`
