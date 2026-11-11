# Backlog (not scheduled)

Ideas recorded for later. These are deliberately **not tickets**, so they do not appear in pass planning.

- **Improve enrichment matching.** Omnibus and combined titles, canonical works with ratings, normalisation, more author separators, preferring works with ratings. Research first; the current overrides are the workaround. Do not add extra unmatched-book storage; the existing enrichment rows are enough.
- **Fallback enrichment sources.** Goodreads or Hardcover for books Open Library lacks or has no ratings for, after the correction workflow is proven.
- **Deploy to the Nix server** behind the existing Cloudflare Tunnel. Explicitly later, after the local passes.
- **More author separators.** Add `;` or "and" to the author facet if they show up in the catalogue.
- **Choose and add a licence.** Decide the licence for the code and for the catalogue data (for example MIT or Apache for code, CC BY or CC0 for data), add a `LICENSE` file, mention it in the README and on `/terms`, and check the Libib and Open Library terms. Legal decision deferred; not a ticket.

Deliberately not backlog items: a report-correction feature (readers contact the Librarian directly) and laptop-sleep handling (the laptop is a development device; the server stays on).
