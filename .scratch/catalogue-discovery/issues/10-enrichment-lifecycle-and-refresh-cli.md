# 10: Enrichment lifecycle and refresh CLI

**What to build:** Enrichment happens once per book record and otherwise only when the Librarian asks. Books added to the sample are enriched automatically, failures are recorded and retryable, and bulk refreshes never undo a Match override.

**Blocked by:** 06, 08, 09

**Status:** done (v1 prototype)

- [ ] Book records newly added to the crawl set are enriched exactly once before their first detail refresh.
- [ ] The Librarian can refresh enrichment for one book record, all unmatched, all failed, or the whole sample.
- [ ] No enrichment runs on a schedule; only first-sight enrichment is automatic.
- [ ] Failed enrichments are recorded and retryable through the failed-only run.
- [ ] Bulk refresh never overwrites a Match override.
