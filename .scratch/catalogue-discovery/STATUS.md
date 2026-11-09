# Catalogue Discovery — Status

Branches (local; no remote, no PR): `feat/catalogue-discovery-v1`, then `feat/catalogue-discovery-pass2`.

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

## Pass 2 — implemented

- [x] 12 Libib book permalink (`?solo=`)
- [x] 13 Badge explanations
- [x] 14 Collapsible filter panel
- [x] 15 Collapsible Subjects facet
- [x] 16 Clear Rating and page-count filters
- [x] 17 Reset detail scroll on open
- [x] 18 Show/hide unmatched filter
- [x] 19 Enrichment source hints

Verification: `typecheck`, `build`, 173 tests green; live API check of `?solo=`, `enrichmentSource` and the tri-state unmatched filter.

## Remaining

- [ ] 11 Bootstrap and snapshots — `needs-info` (deferred; snapshots and the hourly index poll need discussion)

Tickets 12–19 are done; the spec's Post-v1 Backlog stays as the record of what pass 2 built.
