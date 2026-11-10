# Refresh enrichment on startup and daily

Enrichment is no longer one-shot: a full pass runs on First run, on every startup, and after the daily Scheduled catalogue scan, with a persisted one-hour cooldown so rapid restarts do not repeat the pass. Every pass re-reads Rating, Subjects and page count for all visible book records, while Match overrides always win; manual refresh commands remain. Supersedes ADR-0005.

## Consequences

- Ratings are never more than a day stale.
- Traffic to the enrichment source is predictable: one full pass per day plus startups outside the cooldown.
- A crash-looping container does not multiply third-party traffic.
- Hidden books are excluded from every pass.
