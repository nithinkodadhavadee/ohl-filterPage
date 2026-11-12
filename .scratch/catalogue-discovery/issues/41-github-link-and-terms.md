# 41: GitHub link and Terms of Service page

**What to build:** Add a footer link to the project repository
(`https://github.com/nithinkodadhavadee/ohl-filterPage`) and a public `/terms`
page. The page explains, in plain language:

- what the site is (a read-only discovery layer, not Libib or the library's
  system of record);
- that circulation and Holds are informational and borrowing happens in Libib;
- that data comes from Libib and Open Library and may be delayed, with the
  visible refreshed timestamps;
- that there are no accounts and the app sets no tracking cookies;
- that cookieless aggregate Site analytics are collected: no cookies, no stored
  IPs, no persistent identifiers, approximate daily unique visitors, and raw
  Search text only in a private Librarian report; link to `/analytics`;
- that external sites have their own terms;
- that the service is best-effort with no warranty and is not affiliated with
  Libib or Open Library;
- how to report corrections and contact the library;
- that no licence has been chosen yet, so no reuse permission is implied;
- a last-updated date.

`/terms` must work on a direct load, like `/status`. External links open in a new
tab with `rel="noopener noreferrer"`.

**Blocked by:** None (pass 5)

**Status:** implemented (pass 5, pending maintainer copy review and end-to-end QA)

**Note:** Draft the copy for maintainer review. Do not assert a licence, invent
legal guarantees, or copy boilerplate that does not match this read-only site.
The licence decision remains in `BACKLOG.md`, not a ticket.

The analytics disclosure is required by ticket 43; the two land together.

- [ ] The Terms copy discloses cookieless aggregate analytics and links to
      `/analytics`, without claiming a licence.
- [ ] The footer links to GitHub and Terms; GitHub opens in a new tab.
- [ ] `/terms` renders on direct load and from the footer, in production and dev.
- [ ] The page covers the sections listed above, without claiming a licence.
- [ ] The page is readable on mobile and keyboard-accessible.
- [ ] Tests cover the route and the footer links.
- [ ] The maintainer reviews the final copy.
