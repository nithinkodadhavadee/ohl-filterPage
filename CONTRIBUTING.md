# Contributing

Thanks for helping with the Open House Library Discovery page. This document
covers local setup, checks, code style, and how work is tracked. For the
AI-assisted workflow used to plan and implement changes, see
[docs/ai-workflow.md](docs/ai-workflow.md).

## Prerequisites

- **Node 26** (the server uses the built-in `node:sqlite`).
- npm.
- Docker and Docker Compose only if you are testing the container.

## Setup

```sh
npm ci
cp .env.example .env.local
# edit .env.local: SAMPLE_SIZE=50 for a small local Crawl set
npm run seed          # optional: fixtures, no network
npm run dev
```

The API runs on <http://localhost:3000> and Vite on
<http://localhost:5173>. Vite proxies `/api`, `/health` and `/covers`.

Local scripts load `.env` first and then `.env.local`. Docker Compose reads only
`.env`. Keep `SAMPLE_SIZE=0` in `.env` unless you deliberately want a capped
Crawl set; the whole visible Collection is the production default.

## Checks

Run these before opening a pull request:

```sh
npm run typecheck
npm test
npm run build
```

Tests run against temporary SQLite databases and recorded fixtures. They must
never contact Libib or Open Library. If you add a source adapter, record its wire
format as a fixture and test the contract at the adapter seam.

## Code style

- TypeScript everywhere, ES modules, NodeNext imports.
- The HTTP layer stays thin; query, matching, parsing and scheduling logic live
  in their own modules.
- Prefer external behaviour at a seam over assertions on private helpers.
- Keep the domain vocabulary from [CONTEXT.md](CONTEXT.md): **Book record**,
  **Crawl set**, **Catalogue scan**, **Book sweep**, **Enrichment pass**,
  **Snapshot**, **Hidden book**, **Subject**, **Badge**.
- No comments unless they explain something the code cannot.
- Do not reformat unrelated code in a change.

## Data and network rules

- Never commit `data/`, `catalog_data/`, `dist/`, `node_modules/`, `.env` or
  `.env.local`; they are git-ignored.
- Do not run live Libib or Open Library requests from tests.
- Respect Libib's crawl delay. The rolling Book sweep exists to keep traffic
  polite; do not replace it with tight loops.
- If you change a scraper or adapter, update its fixtures and the operations
  documentation.

## How work is tracked

This repository uses a **local markdown issue tracker** (configured in
[docs/agents/issue-tracker.md](docs/agents/issue-tracker.md)), not GitHub
Issues.

- Spec and decision record: `.scratch/catalogue-discovery/spec.md`.
- Tickets: one file per ticket under
  `.scratch/catalogue-discovery/issues/NN-slug.md`.
- Status: `STATUS.md` is the human index; each ticket also has a `Status:` line.
- Unscheduled ideas: `BACKLOG.md`. These are not tickets and do not enter a pass
  by default.
- Triage vocabulary: `docs/agents/triage-labels.md`.

A ticket has `What to build`, `Blocked by`, `Status` and acceptance criteria. The
**frontier** is the set of tickets whose blockers are done; pick from there.
When you finish a ticket, update its `Status` and tick the acceptance criteria you
verified, then update `STATUS.md`.

Used statuses: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`, `done (…)`, and `superseded by …`.

## Documentation duties

Change the documentation in the same change as the behaviour:

| Change | Update |
| --- | --- |
| A domain term or synonym | `CONTEXT.md` |
| A durable trade-off or architecture decision | a new `docs/adr/NNNN-*.md` |
| Product behaviour or scope | `.scratch/catalogue-discovery/spec.md` |
| Executable work | a ticket under `.scratch/catalogue-discovery/issues/` |
| Done/pending | `.scratch/catalogue-discovery/STATUS.md` |
| An unscheduled idea | `.scratch/catalogue-discovery/BACKLOG.md` |
| Commands or environment | `docs/operations.md` |
| Docker or deployment | `docs/docker.md` |
| The AI/process workflow | `docs/ai-workflow.md` |

Use the glossary's words. If a concept is missing from `CONTEXT.md`, either you
are inventing language (reconsider) or the glossary has a real gap (add it).

## Branches, commits and pull requests

- Work on a branch; do not commit directly to `main` if you are not the
  maintainer.
- Suggested names: `feat/<short-name>`, `fix/<short-name>`,
  `docs/<short-name>`.
- Keep commits focused. Match the existing message style: `feat: …`, `fix: …`,
  `docs: …`, `chore: …`, `refactor: …`.
- Do not force-push shared branches.
- A pull request should state the problem, the change, how it was verified, and
  which ticket/spec it implements.

### Pull request checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Behaviour is covered at an existing seam; fixtures are committed.
- [ ] `CONTEXT.md`, ADRs, spec, tickets and `STATUS.md` are updated if needed.
- [ ] `docs/operations.md` or `docs/docker.md` updated if commands or deployment
      changed.
- [ ] No data, secrets, `.env` or generated files included.

## Container changes

If you change the Dockerfile or Compose file, update
[docs/docker.md](docs/docker.md) and verify:

```sh
docker compose config
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:3000/health
```

Docker may not be available in every environment; say so in the pull request if
you could only validate the files statically.

## License

No license has been chosen for this repository yet. Do not add one without the
maintainer's agreement. The decision is tracked in
[BACKLOG.md](.scratch/catalogue-discovery/BACKLOG.md).
