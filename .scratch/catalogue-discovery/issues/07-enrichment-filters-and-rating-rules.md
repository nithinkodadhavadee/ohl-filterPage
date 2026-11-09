# 07: Enrichment filters, facets, Rating rules and sorts

**What to build:** Patrons can filter and sort by enrichment data: a Subject multi-select with counts, a minimum Rating that respects sample size, a page-count range, and the corresponding table columns.

**Blocked by:** 05, 06

**Status:** done (v1 prototype)

- [ ] A Subjects filter presents a plain multi-select with book counts, combining selections as OR.
- [ ] Minimum Rating ignores Ratings with fewer than five contributions by default, with an opt-in to include them.
- [ ] Low-sample Ratings are badged wherever a Rating appears.
- [ ] A page-count range filter works, and book records without a page count are handled predictably.
- [ ] Sorting by Rating and page count works with book records lacking a value last.
- [ ] The table gains Rating, Subjects and page-count columns.
