# Enrich through an adapter, beginning with Open Library

Enrichment — rating, subjects, page count — comes through a per-source adapter so Goodreads, Hardcover, and StoryGraph can be added or substituted without touching the catalogue side. Open Library ships first because it needs no key and is the only source proven reachable: StoryGraph blocks automation behind Cloudflare and has no public API, Goodreads is scrapable but fragile, and Hardcover requires a token. Its sparse ratings and wrong-edition matches (a graded-reader adaptation of 1984, for instance) are mitigated by exact title-plus-author matching with a popularity tiebreak and by manual match overrides.

## Consequences

- Ratings start thin and low-sample; the interface must show sample size rather than pretending a 5.0 from one reader is authoritative.
- Adding a richer source later is an adapter plus a match refresh, not a redesign.
