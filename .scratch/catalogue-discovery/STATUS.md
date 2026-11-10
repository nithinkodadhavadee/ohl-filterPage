# Catalogue Discovery — Status

Branches (local; no remote, no PR): `feat/catalogue-discovery-v1`, then `feat/catalogue-discovery-pass2`. Pass 3 is planned, not yet implemented.

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

## Pass 3 — decided, awaiting review (not implemented)

- [ ] 20 Configurable Crawl set and Hidden books — `ready-for-agent` (no blockers)
- [ ] 21 Startup catch-up and First run — `ready-for-agent` (blocked by 20)
- [ ] 22 Daily Scheduled catalogue scan — `ready-for-agent` (blocked by 21)
- [ ] 23 Snapshots, Restore and Export — `ready-for-agent` (blocked by 20)
- [ ] 24 Infinite scroll — `ready-for-agent` (no blockers)
- [x] 25 Containerisation and deployment — implemented on `p3/25`; Docker build and live healthcheck not verified (Docker unavailable)
- [ ] 26 Canonical CLI and operations documentation — `ready-for-agent` (blocked by 21, 22, 23)

Decisions: ADR-0007 (First run and scheduled scans), ADR-0008 (deployment), ADR-0009 (enrichment cadence), ADR-0010 (snapshots). ADR-0005 and ADR-0006 are superseded.

## Superseded

- [ ] 11 Bootstrap and snapshots — superseded by 20, 21, 22, 23

## Later (needs-triage)

- [ ] 27 Filter by multiple authors — multi-select author picker, OR semantics; author-string vs individual-name question open

