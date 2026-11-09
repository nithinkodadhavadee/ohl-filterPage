# Refresh circulation with a rolling crawler under Libib's crawl-delay

Libib's robots.txt disallows `/u/` and sets `Crawl-delay: 30`, while holds and availability change daily and should feel near-live. Instead of bursty passes that risk an IP block, one background loop reads a single book record every ~30 seconds, completing a full cycle in roughly five hours, then starts again; a cheap index poll runs hourly for added or removed titles, and the crawler backs off on 403/429 while continuing to serve the last good snapshot. Up to five hours of staleness per book is accepted and surfaced to patrons as "refreshed X ago".

## Considered Options

- **Nightly only** — safest, but holds and availability would be up to a day stale.
- **Burst every three hours** — meets the freshness goal but leaves a conspicuous footprint.
- **Aggressive, ~1 request/second** — fastest, highest chance of being throttled or blocked.

## Consequences

- The first-run bootstrap is a deliberate one-time exception to this pacing; see ADR-0006.
