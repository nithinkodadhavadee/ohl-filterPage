# 23: Snapshots, Restore and Export

**What to build:** Snapshots are consistent copies of the SQLite database. One is taken after a Catalogue scan, after a full Enrichment pass, after a Match override import, and on demand; the last ten are kept (configurable). `snapshot` takes one now, `restore` replaces the database from one and refuses while the app is running, and `export` copies one to a chosen path. Cached covers are excluded because they are re-fetchable.

**Blocked by:** 20

**Status:** ready-for-agent

- [ ] `snapshot` writes a consistent timestamped copy under `DATA_DIR/snapshots` and prunes to the configured retain count (default 10).
- [ ] Automatic snapshots fire at the four trigger points and never on every Book sweep cycle.
- [ ] `restore` refuses to run against a live database; the documented sequence is stop, restore, start.
- [ ] `export` copies a snapshot to a given path.
- [ ] A snapshot preserves book records, hidden flags, enrichments and Match overrides; covers are not included.
- [ ] Tests cover snapshot then restore round-tripping the catalogue and overrides.
