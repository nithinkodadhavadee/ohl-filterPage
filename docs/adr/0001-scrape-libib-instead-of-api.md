# Scrape Libib instead of using its API

The library account appears to be on Libib Pro, but its API keys are not available to us and may never be. Libib's public catalogue endpoints answer stateless requests and expose every figure we need, so we scrape those pages rather than integrate through the API. The cost is deliberate: no ISBN, no write access, and no stability guarantee — if API keys ever arrive, the libib adapter is the seam to swap.

## Consequences

- Enrichment matching must work from title and author alone, because no ISBN is exposed.
- Every field we show depends on Libib's public HTML and JSON staying shaped as they are today.
