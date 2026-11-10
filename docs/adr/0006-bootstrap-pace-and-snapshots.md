---
status: superseded by ADR-0007 and ADR-0010
---

# Bootstrap at two seconds and snapshot the database

A 30-second rolling crawl would leave a fresh install unusable for five hours, so the first full pass is a deliberate exception: bootstrap reads the Catalogue index, then one detail request per book record at roughly two seconds, writing records as they arrive and resuming from a cursor before handing off to the rolling crawler. Because a wiped volume would otherwise mean re-scraping and re-enriching everything, the app snapshots the database after bootstrap and after each completed Crawl cycle, keeps seven by default, and offers restore and off-volume export. Covers are excluded from snapshots: they are content-addressed and cheap to re-fetch.

## Consequences

- The first run produces an ~18-minute burst that exceeds the crawl-delay ADR-0002 otherwise honours; this is accepted once per install.
- Snapshots preserve enrichments and Match overrides, so recovery does not repeat third-party traffic.
