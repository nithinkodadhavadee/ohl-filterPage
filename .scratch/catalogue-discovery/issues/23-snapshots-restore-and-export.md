# 23: Snapshots, Restore and Export

**What to build:** Snapshots are consistent copies of the SQLite database. One is taken after a Catalogue scan, after a full Enrichment pass, after a Match override import, and on demand; the last ten are kept (configurable). `snapshot` takes one now, `restore` replaces the database from one and refuses while the server heartbeat is fresh, and `export` copies a fresh Snapshot by default or a chosen existing Snapshot to a path. Cached covers are excluded because they are re-fetchable.

**Blocked by:** 20

**Status:** done (pass 3)

- [ ] `snapshot` writes a consistent timestamped copy under `DATA_DIR/snapshots` and prunes to the configured retain count (default 10).
- [ ] Automatic snapshots fire at the four trigger points and never on every Book sweep cycle.
- [ ] `restore` refuses while the server heartbeat is fresh (under 30 seconds old), proceeds and cleans a stale lock otherwise, and the documented sequence is stop, restore, start.
- [ ] `export` copies a fresh Snapshot to a destination by default, or copies a chosen existing Snapshot when given both a snapshot and a destination.
- [ ] A snapshot preserves book records, hidden flags, enrichments and Match overrides; covers are not included.
- [ ] Tests cover snapshot then restore round-tripping the catalogue and overrides.
