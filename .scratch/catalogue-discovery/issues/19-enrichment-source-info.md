# 19: Enrichment source hints

**What to build:** In the detail view only, an "i" hint explains where each enrichment field came from. Add it next to the existing Rating and Subjects headings, and give page count its own heading with a hint, moving it out of the Publication body. The source name comes from the API so future adapters need no UI edit. Do not add an "i" to the grid or table.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The book API exposes the enrichment source name for enriched books.
- [ ] The detail view shows an "i" next to Rating, Subjects, and a new Page count heading; Publication keeps only publisher and year.
- [ ] Hints read: Rating — "Sourced from Open Library. Ratings may be sparse or describe a different edition."; Subjects — "Sourced from Open Library; raw subjects, not genres."; Page count — "Sourced from Open Library; may be missing or describe a different edition." The source name is interpolated from the API.
- [ ] Hints open on hover, keyboard focus and tap, and close on mouse-out, blur or tapping elsewhere.
- [ ] No "i" appears in the grid or table, and badges use their own explanation rather than an "i".
