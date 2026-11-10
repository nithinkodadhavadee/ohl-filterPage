---
status: superseded by ADR-0009
---

# Enrich each book once, and refresh only on command

Enrichment data changes slowly and the librarian does not want automatic re-fetching, so a book record is enriched exactly once — when the crawler first sees it — and the result is stored. Refreshing is an explicit administrative action, available for one book, for unmatched books, or for the whole catalogue. The consequence is that ratings drift until someone refreshes them, which is accepted in exchange for predictable, minimal traffic to third-party sources.

## Consequences

- The enrichment adapters never run on a schedule; only the Libib crawler is periodic.
- A newly catalogued book is enriched in the same pass that first discovers it.
