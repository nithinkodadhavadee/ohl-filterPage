# 09: Match overrides and unmatched export

**What to build:** The Librarian can correct bad enrichment matches and get a worklist of books that could not be matched. A CSV pins a book record to the right enrichment record, an export lists what is still unmatched, and corrections survive later enrichment runs.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A CSV import pins a book record to an enrichment record using join id, source, source record id or URL, and an optional note; invalid rows are reported.
- [ ] A Match override takes precedence over automatic matching.
- [ ] An export lists every unmatched book record with join id, title and author.
- [ ] An override survives re-running enrichment for that book record.
