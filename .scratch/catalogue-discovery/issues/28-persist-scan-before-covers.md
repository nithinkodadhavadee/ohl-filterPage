# 28: Persist Catalogue scan records before downloading covers

**What to build:** A Catalogue scan must persist its book records before it starts downloading covers. Today it downloads a cover for every target record before committing any book record, so an interrupted scan leaves an empty catalogue even though covers were fetched (observed: 268 covers on disk, 0 book records). Persist the target records, the hide/unhide changes and the FTS rows in one transaction immediately after the index is parsed; then download covers and update `cover_path` durably as each cover lands. Existing covers are reused, and missing covers stay null and are retried on the next scan. Enrichment of newly added records and the completion hook keep working.

**Blocked by:** None (can start immediately)

**Status:** done (pass 3 follow-up)

- [ ] Book records are visible through `/api/books` as soon as the index phase commits, before cover downloads finish.
- [ ] Interrupting the scan during cover downloads leaves the book records persisted.
- [ ] Successful covers set `cover_path`; failed or missing covers leave it null and are retried on the next scan.
- [ ] Hide/unhide, FTS updates and the scan result counts stay correct.
- [ ] Tests simulate a cover failure after persistence and assert the records remain; the rest of the suite stays green.
