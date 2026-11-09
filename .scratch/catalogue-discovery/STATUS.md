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

## Pass 2 — decided, ready for agents

- [ ] 11 Bootstrap and snapshots — `needs-info` (deferred; snapshots and the hourly index poll need discussion)
- [ ] 12 Libib book permalink (`?solo=`) — `ready-for-agent`
- [ ] 13 Badge explanations — `ready-for-agent`
- [ ] 14 Collapsible filter panel — `ready-for-agent`
- [ ] 15 Collapsible Subjects facet — `ready-for-agent`
- [ ] 16 Clear Rating and page-count filters — `ready-for-agent`
- [ ] 17 Reset detail scroll on open — `ready-for-agent`
- [ ] 18 Show/hide unmatched filter — `ready-for-agent`
- [ ] 19 Enrichment source hints — `ready-for-agent`

Tickets 12–19 come from the decided Post-v1 Backlog in `spec.md`. None are implemented.
