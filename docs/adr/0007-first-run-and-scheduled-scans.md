# First run and scheduled catalogue scans use the normal sweep pace

On an empty database, First run performs a Catalogue scan, then starts the Book sweep and a full Enrichment pass in parallel at the normal 30-second pacing; there is no faster start. On every start with an existing database, the app runs a Catalogue scan, serves stored data while it happens, then starts a full Enrichment pass and resumes the Book sweep. A Scheduled catalogue scan runs daily by default (configurable), triggers a full Enrichment pass, and retries with backoff before waiting for the next run.

## Consequences

- A fresh install shows catalogue entries within minutes and completes circulation over roughly 4.5 hours.
- Startup always revalidates the catalogue, so a restored or stale database catches up without a special command.
- Supersedes ADR-0006's two-second first-run pace.
