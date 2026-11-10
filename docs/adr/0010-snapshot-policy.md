# Snapshot on catalogue and enrichment changes, keep ten

A Snapshot is a consistent copy of the SQLite database. Take one after a Catalogue scan, after a full Enrichment pass, after a Match override import, and on demand; retain the last ten (configurable). Restore requires the app to be stopped, and Export copies a snapshot off-host; cached covers are excluded because they are re-fetchable. Supersedes ADR-0006's per-cycle snapshot policy.

## Consequences

- Recent circulation may be lost on restore; it is cheap to re-sweep.
- Hidden books, enrichments and Match overrides survive a restore.
- Restoring never fights a running Book sweep, because the app is stopped first.
