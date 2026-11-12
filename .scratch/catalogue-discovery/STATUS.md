# Catalogue Discovery — Status

Branches (local; no PR): `feat/catalogue-discovery-v1`, `feat/catalogue-discovery-pass2`, `feat/catalogue-discovery-pass3`, `feat/catalogue-discovery-pass4`, `feat/pass5`.

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

## Pass 3 — implemented

- [x] 20 Configurable Crawl set and Hidden books
- [x] 21 Startup catch-up and First run
- [x] 22 Daily Scheduled catalogue scan
- [x] 23 Snapshots, Restore and Export
- [x] 24 Infinite scroll
- [x] 25 Containerisation and deployment — static verification only; Docker build and live healthcheck not run (Docker unavailable)
- [x] 26 Canonical CLI and operations documentation
- [x] 28 Persist Catalogue scan records before downloading covers (found during first container test; records now appear before covers finish)
- [x] 29 Graceful container shutdown (Node runs directly as PID 1; stop exits 0 and releases the server lock)

Verification: `typecheck`, `build`, 231 tests green. Deployment files statically validated; the first real `docker compose up` and Cloudflare Tunnel test happen on the Nix server.

Decisions: ADR-0007 (First run and scheduled scans), ADR-0008 (deployment), ADR-0009 (enrichment cadence), ADR-0010 (snapshots). ADR-0005 and ADR-0006 are superseded.

## Superseded

- [ ] 11 First run and snapshots — superseded by 20, 21, 22, 23

## Pass 4 — implemented

- [x] 27 Filter by multiple authors — searchable multi-select of split author names
- [x] 30 Enrichment status and run log — shared job history, last pass, counts, errors
- [x] 31 Enrichment source link — source name, matched-record link and enriched-at
- [x] 32 Book sweep completion and failures — last cycle, progress estimate, ledger and audit
- [x] 34 Status page — public /status with current state and lazy run history

Verification: `typecheck`, `build`, 290 tests green. Unscheduled ideas live in `BACKLOG.md`; they are not tickets and do not enter pass planning.

## Pass 5 — implemented (pending end-to-end QA)

- [x] 35 Back to top button
- [x] 36 Header link to Libib
- [x] 37 Sweep audit as a cumulative worklist with an attempted column
- [x] 38 Copy-link with an HTTP-safe fallback
- [x] 39 Remove the "Not yet swept" message
- [x] 40 Include low-sample ratings by default
- [x] 41 GitHub link, Terms page and analytics disclosure — copy needs maintainer review
- [x] 42 Publish on all interfaces on host port 3002 — ADR-0012 supersedes ADR-0008
- [x] 43 Site analytics — ADR-0011

Verification: `typecheck`, `build`, 337 tests green; `docker compose config` validates. End-to-end QA on the Nix server is pending. Code review findings were addressed in the local integration branch.

Decisions: ADR-0011 (Site analytics), ADR-0012 (publish on all interfaces). ADR-0008 is superseded.

## Superseded

- [ ] 11 Bootstrap and snapshots — superseded by 20, 21, 22, 23

## Backlog

Unscheduled ideas live in `BACKLOG.md` (matching improvements, fallback sources, licence). No backlog items were promoted into Pass 5.
