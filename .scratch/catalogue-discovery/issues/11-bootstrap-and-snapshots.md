# 11: Bootstrap and snapshots

**What to build:** A fresh install becomes usable in roughly eighteen minutes, with books filling in progressively, and the scraped data can be recovered without going back to Libib. A one-time bootstrap reads the index and then each book's detail at a deliberate pace, resuming if interrupted; the database is snapshotted automatically, and the Librarian can restore or export a snapshot.

**Blocked by:** 03

**Status:** needs-info

**Note:** Deferred past v1. At 50 books the bootstrap is simply the first crawler pass. Snapshots need a conversation before implementation.

**Needs conversation:** snapshot trigger points, retention, restore and export, and whether they are worth the ceremony at this scale.

- [ ] A one-time bootstrap reads the index and then one detail request per book record at roughly two seconds, writing records as they arrive.
- [ ] An interrupted bootstrap resumes from its persisted cursor rather than starting over.
- [ ] A consistent database snapshot is written after bootstrap and after each completed Crawl cycle, retaining a configurable number of recent snapshots (default seven).
- [ ] A restore command replaces the live database from a snapshot and refuses to run while the crawler is active.
- [ ] An export command writes a snapshot to an arbitrary destination, and snapshots preserve enrichments and Match overrides.
- [ ] Cached covers are excluded from snapshots and re-fetched when absent.
