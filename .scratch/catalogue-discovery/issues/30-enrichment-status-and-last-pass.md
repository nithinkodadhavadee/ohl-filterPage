# 30: Enrichment status, run history and last pass

**What to build:** Add a shared **run log** and expose enrichment status. Every job run is one row: `kind` (Catalogue scan, Enrichment pass, Book sweep cycle, Snapshot, Restore, Export, Override import), `trigger` (startup, scheduled, manual, automatic), `status` (running, ok, partial, failed), `started_at`, `finished_at`, `duration`, per-kind `counts`, `error` and `note`. Do not prune the table; rows are tiny. Expose the last completed full Enrichment pass, counts by status for visible books, in-progress state, next scheduled refresh, last error and the run history. Expose a book's `enrichedAt` for ticket 31. Tickets 32 and 34 build on this run log.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A run-log table exists with the fields above and is created by an idempotent migration.
- [ ] Every Enrichment pass writes a `running` row and finishes it with status, counts and error.
- [ ] `/api/status` exposes last full pass time, counts by enrichment status, in-progress state, next run, last error and run history.
- [ ] Counts exclude Hidden books.
- [ ] A book's `enrichedAt` is exposed for the detail view.
- [ ] Tests cover the schema, the status shape, Hidden exclusion and failure recording.
