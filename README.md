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

## Development

One command runs the API on port 3000 and the Vite UI on port 5173:

```sh
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api`, `/health` and `/covers` to
the API.

Environment variables:

| Variable   | Default  | Meaning                                      |
| ---------- | -------- | -------------------------------------------- |
| `PORT`     | `3000`   | API port                                     |
| `DATA_DIR` | `./data` | SQLite database and cached covers directory  |

## Scripts

| Script              | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Run API and Vite UI together                      |
| `npm run build`     | Compile the server and build the frontend         |
| `npm start`         | Serve the built app on `PORT`                     |
| `npm run seed`      | Idempotently load fixtures into the database      |
| `npm test`          | Run the HTTP-seam tests                           |
| `npm run typecheck` | Type-check the server and client                  |

## API

- `GET /health` → `{ "status": "ok" }`
- `GET /api/books?limit=&offset=` → `{ items, total, nextOffset, meta }`
- `GET /api/books/:joinId` → one book, or `404`
- `GET /covers/<file>` → cached cover from `DATA_DIR/covers`
