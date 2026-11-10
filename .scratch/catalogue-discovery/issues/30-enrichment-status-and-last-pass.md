# 30: Show enrichment status and the last full pass

**What to build:** The Librarian cannot tell whether an Enrichment pass has finished, how many books are unmatched, or when the next pass runs without querying the database. Expose a clear status: the last completed full pass time, counts by status (enriched, unmatched, failed), in-progress state, the next scheduled refresh and the last error. Show it in the API and in a compact status area on the page.

**Blocked by:** None (next-pass candidate)

**Status:** needs-triage

- [ ] `/api/status` exposes `lastFullPassAt`, counts by status, `inProgress`, `nextRunAt` and `lastError`.
- [ ] Counts exclude Hidden books.
- [ ] A book's `enrichedAt` is available to the detail view (ticket 31 uses it).
- [ ] The UI shows the enrichment status in a compact, mobile-friendly area.
- [ ] Tests cover the status shape and the Hidden exclusion.
