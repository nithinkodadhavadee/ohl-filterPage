# 27: Filter by multiple authors

**What to build:** Replace the single author text box with a multi-select author picker. Selecting several authors shows books by any of the selected authors (OR). The picker is populated from the author facet with counts, combines with every other filter as AND, and is encoded in the URL alongside the rest of the view state.

**Blocked by:** None (deferred; tackle after Pass 3)

**Status:** needs-triage

**Open questions:** The current filter is a case-insensitive substring over one author string, and the facet stores the whole string as Libib supplies it (for example "Peter H. Diamandis, Steven Kotler"). Should the picker list those whole strings, or split them into individual authors? Splitting risks "Last, First" formats and names containing commas. Should free-text author search remain alongside the picker?

- [ ] A multi-select author picker replaces the single author input.
- [ ] Selecting several authors shows books by any of them (OR), and categories still combine as AND.
- [ ] Each option shows a book count.
- [ ] The selection is encoded in the URL and restored with the other filters.
- [ ] The control is keyboard-accessible and works on mobile.
