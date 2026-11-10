# 21: Startup catch-up and First run

**What to build:** On every start the app runs a Catalogue scan, then a full Enrichment pass and the normal 30-second Book sweep in parallel; stored data is served throughout with its refreshed timestamps. An empty database is simply the First run of the same sequence, with no faster start. The last completed full Enrichment pass is persisted, and a startup pass is skipped if one finished within the last hour.

**Blocked by:** 20

**Status:** done (pass 3)

- [ ] Empty database: Catalogue scan, then Enrichment pass and Book sweep in parallel; no special 2-second start.
- [ ] Populated database: a Catalogue scan runs on every start, and data is served while the scan, Enrichment pass and Book sweep run.
- [ ] The startup Enrichment pass covers all visible book records, including already-enriched ones; Match overrides win and hidden records are excluded.
- [ ] The one-hour cooldown is persisted and survives restarts; a restart within it skips the full pass.
- [ ] Scan or enrichment failures do not block serving the stored catalogue.
