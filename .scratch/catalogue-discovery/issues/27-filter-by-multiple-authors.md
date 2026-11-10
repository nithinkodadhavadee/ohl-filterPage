# 27: Filter by multiple authors

**What to build:** Replace the single author text box with a searchable multi-select of individual author names. Build the facet by splitting each Libib author string on `&` and `,` (trim, dedupe, group case-insensitively, display the most common spelling), so "Peter H. Diamandis, Steven Kotler" becomes two options. With no search text the full author list is shown; typing filters the options. Selecting one or more authors shows books whose author string contains any selected name (OR, case-insensitive), while other filter categories still combine as AND. Selections are encoded in the URL. There is no separate free-text author filter.

**Blocked by:** None (can start immediately)

**Status:** done (pass 4)

- [ ] The author facet splits on `&` and `,`, trims and dedupes, groups case-insensitively, and shows a book count per name.
- [ ] The control shows every author when the search box is empty and filters options as the Patron types.
- [ ] Multiple selections combine as OR; each selection matches any book whose author string contains that name, case-insensitively.
- [ ] Selecting an author matches co-authored books (for example selecting "Peter H. Diamandis" finds the Diamandis/Kotler record).
- [ ] Selections round-trip through the URL, combine with the other filters, and can be cleared.
- [ ] The control is keyboard-accessible and works on mobile.
- [ ] Tests cover splitting, case-insensitive grouping, OR matching, co-authored records and URL round-tripping.
