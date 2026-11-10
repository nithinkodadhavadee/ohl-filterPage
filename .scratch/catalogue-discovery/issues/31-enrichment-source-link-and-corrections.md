# 31: Link each book to its enrichment source and allow corrections

**What to build:** In the book detail view, show the enrichment source, a link to the matched record (for example `https://openlibrary.org/works/OL...W`), and when it was enriched, so anyone can verify the match. Add a "Report a correction" link that opens a prefilled message containing the title, Libib join id and source URL. Unmatched books show no source link, explain that no record was found, and offer the same reporting route.

**Blocked by:** None (next-pass candidate)

**Status:** needs-triage

- [ ] Enriched books show the source name, a link to the matched record and the enriched-at time.
- [ ] Unmatched books show no source link and an explanation instead.
- [ ] A "Report a correction" link is prefilled with the book title, join id and source URL (or a clear no-match description).
- [ ] The API exposes the enriched-at time and enough source information to build the link.
- [ ] The link is keyboard-accessible and works on mobile.
