# 31: Show the enrichment source on a book

**What to build:** In the book detail view, show the enrichment source, a link to the matched record (for example `https://openlibrary.org/works/OL...W`) and the enriched-at time, so anyone can verify the match. Unmatched books show no source link and explain that no record was found. There is no report-correction feature: readers contact the Librarian directly.

**Blocked by:** 30 (needs the exposed `enrichedAt`)

**Status:** ready-for-agent

- [ ] Enriched books show the source name, a link to the matched record and the enriched-at time.
- [ ] Unmatched books show no source link and an explanation instead.
- [ ] The API exposes the source record id or URL and the enriched-at time.
- [ ] No reporting or correction form is added.
- [ ] The link is keyboard-accessible and works on mobile.
