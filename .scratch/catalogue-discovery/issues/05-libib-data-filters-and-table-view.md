# 05: Libib-data filters and table view

**What to build:** Patrons can narrow the catalogue using the library's own data and switch to a dense table. Author, Libib tag, Hold bucket and Available-only filters combine correctly, all 50 book records load at once, and the layout works on phones and laptops.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] Filters exist for author, one or more Libib tags, one or more Hold buckets (0, 1–2, 3–5, 6+) and Available-only.
- [ ] Categories combine as AND; selections within a category combine as OR.
- [ ] A table view shows cover and title, author, Holds, availability and copies/out alongside the cover grid.
- [ ] Every book record in the v1 sample loads in a single request; no paging or infinite scroll is required.
- [ ] The table collapses to stacked cards on narrow screens.
