# 04: Search, sort and shareable state

**What to build:** Patrons can search and order the catalogue. Free text searches title, author and description with typo tolerance; results sort by title, author, Holds, year or random; direction toggles; and the whole state is encoded in the URL so a filtered view can be bookmarked or shared.

**Blocked by:** 03

**Status:** done (v1 prototype)

- [ ] Free-text search covers title, author and description, and a typo such as "tolkain" finds Tolkien.
- [ ] Search results are ordered by relevance when text is present.
- [ ] Sorting works for title, author, Holds, year and random; direction toggles; book records without a value sort last.
- [ ] Random order is stable for a given seed across reloads and shared URLs.
- [ ] Search, sort and direction round-trip through the URL so the view is shareable.
