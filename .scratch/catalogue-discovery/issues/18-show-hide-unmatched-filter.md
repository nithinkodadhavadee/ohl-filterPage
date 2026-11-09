# 18: Show/hide unmatched filter

**What to build:** A Patron can include or exclude book records whose enrichment is unmatched, so books labelled "rating/subjects unknown" can be filtered out or isolated deliberately.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The control offers three states: All books, Hide unmatched, Only unmatched.
- [ ] It defaults to All books.
- [ ] It uses the authoritative enrichment status, not the presence of a Rating or Subjects.
- [ ] It combines with search and every other filter, and is encoded in the URL.
