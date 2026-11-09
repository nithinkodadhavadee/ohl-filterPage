# Catalogue Discovery — Status

Branch: `feat/catalogue-discovery-v1` (local; no remote, no PR).

## v1 prototype — implemented and verified

- [x] 01 Walking skeleton
- [x] 02 Catalogue index scrape, sample and covers
- [x] 03 Per-book circulation, availability and detail view
- [x] 04 Search, sort and shareable state
- [x] 05 Libib-data filters and table view
- [x] 06 Enrichment pipeline and unmatched labelling
- [x] 07 Enrichment filters, facets, Rating rules and sorts
- [x] 08 Rolling crawler, backoff and status
- [x] 09 Match overrides and unmatched export
- [x] 10 Enrichment lifecycle and refresh CLI

Verification: `typecheck`, `build`, 148 tests green; live run with 50 book records, 38 enriched, 12 unmatched, covers cached.

## Remaining

- [ ] 11 Bootstrap and snapshots — `needs-info` (deferred; snapshots and the hourly index poll need discussion)
- [ ] 12 Libib book permalink — `needs-info`
- [ ] 13 Tooltips for derived badges — `needs-triage`
- [ ] 14 Collapsible filter panel — `needs-triage`
- [ ] 15 Collapsible Subjects facet — `needs-triage`
- [ ] 16 Clear Rating and page-count filters — `needs-triage`
- [ ] 17 Reset detail scroll on open — `needs-triage`
- [ ] 18 Show/hide unmatched filter — `needs-triage`
- [ ] 19 Enrichment source info affordance — `needs-triage`

Tickets 12–19 come from the Post-v1 Backlog section in `spec.md`. None are implemented.

## Local state

- `data/` holds the live 50-book sample, cached covers and enrichment. It is git-ignored; a fresh clone must run `resample`, `refresh` and `enrich -- --all`.
