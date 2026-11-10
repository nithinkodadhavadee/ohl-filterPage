# 24: Infinite scroll

**What to build:** The catalogue loads in batches of 24 as the Patron scrolls, in both grid and table views, with lazy-loaded covers. Search, filters and sort are preserved across batches and stay in the URL; scroll position does not.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The first batch is 24 book records; the next batch loads as the Patron approaches the bottom, with no duplicates or skipped records.
- [ ] It works with the full 540-record Collection, not just the 50-book sample.
- [ ] Covers below the fold are lazy-loaded.
- [ ] Search, filters and sort persist across batches and remain in the URL.
- [ ] API paging tests and client paging-helper tests cover the behaviour.
