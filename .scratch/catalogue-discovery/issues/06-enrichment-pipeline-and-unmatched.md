# 06: Enrichment pipeline and unmatched labelling

**What to build:** A book record can gain a Rating, Rating count, Subjects and page count from Open Library, while books that cannot be matched are clearly labelled rather than silently blank. Enrichment is a command the Librarian runs, never a schedule.

**Blocked by:** 02

**Status:** done (v1 prototype)

- [ ] An enrichment command enriches a single book record by its join id.
- [ ] Matching requires a normalized title plus author-surname match, and when several works qualify the one with the most ratings wins.
- [ ] Rating average, Rating count, Subjects and page count are stored and shown in the detail view with their sample size.
- [ ] Unmatched book records are labelled "rating/subjects unknown" in the grid, table and detail view.
- [ ] No enrichment runs on a schedule.
