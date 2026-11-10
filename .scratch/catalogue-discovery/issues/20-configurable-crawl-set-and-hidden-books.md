# 20: Configurable Crawl set and Hidden books

**What to build:** The Crawl set becomes configurable and hidden-capable. `SAMPLE_SIZE` (0 or unset = the whole visible Collection; local development sets 50) bounds which book records a Catalogue scan persists and which the sweeps cover. When a Catalogue scan no longer finds a stored book in Libib, it becomes **Hidden** rather than deleted: excluded from the API, facets, page, Book sweep and Enrichment pass, while its rows and Match override remain. If the book reappears, it is unhidden and refreshed normally.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `SAMPLE_SIZE` unset or 0 stores the whole visible Collection; 50 caps the local development Crawl set.
- [ ] A Catalogue scan marks records missing from Libib as Hidden; hidden records are absent from `/api/books`, `/api/facets` and their counts.
- [ ] A returning join id is unhidden and keeps its stored enrichment and Match override.
- [ ] Book sweep and Enrichment pass skip hidden records.
- [ ] Tests cover hide/restore and the sample-size boundary.
