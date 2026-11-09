# 02: Catalogue index scrape, sample and covers

**What to build:** The discovery page lists the real Collection instead of fixtures. An on-demand index run reads every page of Libib's Catalogue index, applies the frozen sample rule, persists only the sampled 50 book records, and caches their covers locally so the page no longer depends on Libib's CDN.

**Blocked by:** 01

**Status:** done (v1 prototype)

- [ ] An on-demand index command reads every page of the Catalogue index and persists only the book records selected by the frozen sample rule: A-first, J soft, 50 hard, titles before A excluded.
- [ ] The full index is read even though only 50 book records are stored.
- [ ] Real titles, authors and covers replace the fixtures after the run.
- [ ] Titles containing HTML entities render correctly.
- [ ] Covers are downloaded once and served locally; missing covers show a placeholder.
- [ ] A manual resample command re-picks the sample, and a sampled book record that disappears from Libib is removed without automatic replacement.
