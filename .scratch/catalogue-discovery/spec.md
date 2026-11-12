Status: ready-for-agent

# Catalogue Discovery Page

## Problem Statement

The Open House Library keeps its catalogue in Libib. Patrons can browse it, but Libib's public interface only offers sorting and filtering by item type and a handful of coarse Libib tags. It cannot filter by what a book is about, how well it is rated, how long the hold queue is, who wrote it, how long it is, or whether a copy is actually obtainable now. Patrons who want "a highly rated short novel that isn't already spoken for" have to scan manually.

In addition, the library's circulation signals — holds, copies out, and availability — are only visible one book record at a time inside Libib, and there is no way to search or sort across them.

## Solution

A read-only, publicly accessible discovery page over the library's Collection. It presents every book record as a cover grid or a dense table, with search and filters spanning the enrichment data (Rating, Subject, page count) and the library's own circulation data (Hold queue length, copies out, availability). Filters combine as AND across categories and OR within a category, are encoded in the URL, and pages load continuously. Each book opens to a detail view with description, publication data, cover, Rating and its sample size, and per-book refreshed time, plus a link back to Libib where Borrowing and holds actually happen.

Hold queue and availability figures refresh automatically through a polite rolling crawl of Libib, while rating and Subject data is fetched once per book and refreshed only when the Librarian asks. Patrons always see how fresh the data is.

The first release is a local prototype over a 50-book sample; see the v1 Scope below for what is built now and what waits.

## v1 Scope (prototype)

v1 is a **local-only prototype**, run on the Librarian's machine to validate the page before any deployment is considered. It works against a frozen sample of 50 book records rather than the whole Collection. It does not run in a container, does not sit behind a public URL, and does not take database snapshots. Where this section conflicts with the Implementation Decisions below, this section wins for v1.

### In v1

- A local dev server with a seed command, a health endpoint and the HTTP-seam test harness; no container.
- A full read of the Catalogue index, with only the sampled 50 book records persisted and shown.
- Per-book circulation, availability, Libib tags, description and publication data for those 50, with a detail view.
- Covers cached locally for those 50.
- Free-text search, sorting, and shareable URL state.
- Filters over Libib data — author, Libib tags, Hold buckets, Available-only — plus a table view. All 50 load at once.
- Open Library enrichment: Rating, Rating count, Subjects and page count, with unmatched book records labelled.
- Enrichment-driven filters: Subjects, minimum Rating with the low-sample rule, and page-count range.
- A rolling crawler over the frozen 50, including backoff and status; no hourly index poll.
- CSV Match overrides and an unmatched export.
- Each sampled book record enriched once, plus refresh commands for one, all, unmatched and failed.
- A mobile-first layout that still works well on a laptop, HTTP-seam tests and manual QA.

### The v1 sample

- The crawler reads the Catalogue index in full because it is cheap, then selects the first 50 titles in title order starting at A.
- Title order is Libib's own title sort, which ignores leading articles such as "The".
- Titles that sort before A (digits, symbols) are excluded.
- J is a soft boundary: if the walk reaches the end of J with fewer than 50, it continues past J until 50.
- 50 is a hard cap: the walk stops the moment the count reaches 50.
- The sample is frozen once chosen. A manual resample command re-picks it; automatic re-sampling is out of scope.
- If a sampled book record disappears from Libib, it is removed and not automatically replaced; a manual resample restores the count.

### Out of v1, or delayed

These were deferred past v1 and are now decided in Pass 3 at the end of this document: First run and snapshots, Docker/Compose/deployment, the Scheduled catalogue scan, and infinite scroll. Browser tests and accessibility audits remain deferred. Everything under Out of Scope stays out.

### Needs discussion before implementation

Resolved in Pass 3 at the end of this document.

## User Stories

These describe the target product. The v1 Scope above determines which of them ship in the prototype.

### Browsing

1. As a Patron, I want to browse the whole Collection as a cover grid, so that I can discover books visually.
2. As a Patron, I want to switch between a cover grid and a table view, so that I can choose visual browsing or dense scanning.
3. As a Patron, I want to keep browsing with infinite scroll, so that I do not lose my place or click through pages.
4. As a Patron, I want a cover placeholder when an image is missing, so that the grid never looks broken.
5. As a Patron, I want the page to work well on my phone, so that I can browse anywhere.
6. As a Patron, I want to open a book's detail view, so that I can read its description and see everything known about it.
7. As a Patron, I want a link from a book to its Libib page, so that I can place a Hold.
8. As a Patron, I want to copy a direct link to a book, so that I can send it to someone.

### Search

9. As a Patron, I want to search across title, author, and description, so that I can find a book from partial memory.
10. As a Patron, I want search to tolerate typos, so that a misspelling does not return nothing.
11. As a Patron, I want search results ranked by relevance, so that the best match appears first.
12. As a Patron, I want search and filters to combine, so that I can search within a filtered set.

### Subject and tag filtering

13. As a Patron, I want to filter by one or more Subjects, so that I can find books on a topic.
14. As a Patron, I want multiple selected Subjects to combine as OR, so that selecting several broadens my results.
15. As a Patron, I want to see how many book records carry each Subject, so that I can judge which labels are useful.
16. As a Patron, I want the interface to call these Subjects rather than genres, so that I am not misled about how clean the taxonomy is.
17. As a Patron, I want to filter by Libib tag, so that I can use the library's own labels such as fiction and nonfiction.
18. As a Patron, I want multiple selected Libib tags to combine as OR, so that I can widen a shelf-based filter.
19. As a Patron, I want different filter categories to combine as AND, so that results satisfy every constraint I set.

### Author

20. As a Patron, I want to filter by author, so that I can see everything the library holds by an author I like.
21. As a Patron, I want author suggestions as I type, so that I do not have to guess exact spelling.

### Rating

22. As a Patron, I want to filter by minimum Rating, so that I only see books that readers rate well.
23. As a Patron, I want to see a Rating's sample size, so that I can judge how much to trust it.
24. As a Patron, I want Ratings built on fewer than five contributions to be badged as low-sample, so that I do not over-trust a single reader.
25. As a Patron, I want the Rating filter to ignore low-sample Ratings by default, so that filtering stays meaningful.
26. As a Patron, I want to opt in to low-sample Ratings, so that niche books remain findable.
27. As a Patron, I want Books with no Rating to be excluded when a Rating filter is active, so that the filter does what it says.

### Circulation filtering

28. As a Patron, I want to filter by Hold queue length using buckets, so that I can find books with no queue or books that are in demand.
29. As a Patron, I want to select several Hold buckets at once, so that I can exclude only the ranges I care about.
30. As a Patron, I want to filter to books that are Available, so that I do not fall for a book I cannot borrow without waiting.
31. As a Patron, I want unavailable books shown by default with a clear badge, so that I still know the library owns them.
32. As a Patron, I want to see Copies, Out, and Holds together, so that I understand supply and demand at a glance.
33. As a Patron, I want the meaning of Available to be consistent everywhere, so that I trust the badge.

### Length and publication

34. As a Patron, I want to filter by page-count range, so that I can choose something short or something substantial.
35. As a Patron, I want to sort and scan by publication year, so that I can find recent or older books.
36. As a Patron, I want to see publisher and year on the detail view, so that I can identify the edition.

### Sorting and sharing

37. As a Patron, I want to sort by title, author, Rating, Holds, year, page count, or random, so that I can order results the way I browse.
38. As a Patron, I want to toggle sort direction, so that I can flip ascending and descending.
39. As a Patron, I want books without a value to sort last rather than first, so that empty data does not dominate.
40. As a Patron, I want the random order to stay stable while I scroll, so that infinite scroll does not repeat or skip books.
41. As a Patron, I want my filters and sort encoded in the URL, so that I can bookmark or share a filtered view.

### Freshness and trust

42. As a Patron, I want to see when the catalogue index was last refreshed, so that I know how current the page is.
43. As a Patron, I want to see when a specific book's circulation figures were last refreshed, so that I can judge that book precisely.
44. As a Patron, I want the page to keep working from the last good data when Libib is unavailable, so that a scraping hiccup does not take the page down.
45. As a Patron, I want unmatched books clearly labelled "rating/subjects unknown", so that blanks do not look like errors.

### Librarian operation

46. As the Librarian, I want the catalogue to refresh automatically, so that I do not have to run anything.
47. As the Librarian, I want newly added book records to appear without manual action, so that the page stays current.
48. As the Librarian, I want deleted book records to disappear, so that the page reflects reality.
49. As the Librarian, I want the crawler to slow down and back off when Libib throttles, so that our address is not blocked.
50. As the Librarian, I want the page to serve the last good snapshot while the crawler is backing off, so that Patrons are not left with an empty site.
51. As the Librarian, I want to see crawler health, so that I know when data has stopped updating.
52. As the Librarian, I want each book enriched exactly once when first seen, so that third-party traffic is minimal and predictable.
53. As the Librarian, I want to refresh enrichment for one book, so that I can fix a stale or wrong Rating.
54. As the Librarian, I want to refresh all unmatched books, so that retrying a batch is cheap.
55. As the Librarian, I want to refresh the whole catalogue deliberately, so that I can take a snapshot when I choose.
56. As the Librarian, I want a CSV of unmatched books, so that I can research them outside the app.
57. As the Librarian, I want to supply Match overrides in a CSV, so that I can pin a book record to the correct enrichment record.
58. As the Librarian, I want Match overrides to survive re-scrapes and re-enrichment, so that my corrections stick.
59. As the Librarian, I want enrichment never to run on a schedule, so that I stay in control of third-party traffic.

### Deployment and operations

60. As the operator, I want to run the whole thing with Docker Compose, so that I can host it on my Nix server and elsewhere.
61. As the operator, I want the SQLite database and cached covers on a mounted volume, so that restarts do not lose state.
62. As the operator, I want configuration through environment variables, so that I can tune port, data location, and crawl pacing without rebuilding.
63. As the operator, I want the crawl to resume sensibly after a restart, so that an interrupted cycle does not start from scratch or duplicate work.
64. As the operator, I want a health endpoint, so that I can monitor the service and its crawler.
65. As the operator, I want no login screen, so that Patrons can use the page immediately.

### Initial load and recovery

66. As the Librarian, I want the first full scrape to finish in roughly 18 minutes at a deliberate pace, so that the page is useful the same day without hammering Libib.
67. As the Librarian, I want the first scrape to fill in books progressively and resume if interrupted, so that a failure does not discard an hour of work.
68. As a developer, I want fixtures and a seed command, so that I can build the page without scraping Libib at all.
69. As the Librarian, I want an automatic snapshot after the first scrape and after each completed Crawl cycle, so that data loss never forces a re-scrape.
70. As the Librarian, I want to restore the database from a snapshot, so that I can recover from a bad change or a wiped volume.
71. As the Librarian, I want to export a snapshot off the server, so that I keep a copy somewhere other than the volume.

## Implementation Decisions

### Shape

- One TypeScript application delivered in a single Docker image: an HTTP server, a SQLite database, a built React frontend served as static assets, and the rolling crawler running in the same process group.
- Docker Compose file with a named volume for the database and cover cache, and environment configuration for port, data directory, cycle delay, index-poll interval, and backoff bounds.
- No authentication. No write endpoints exposed to Patrons. Administrative actions are CLI commands run through the container.
- The same image carries a fixture-seeding command, a one-time First-run mode, and snapshot/restore commands.
- Single-context domain documentation: `CONTEXT.md` at the root and `docs/adr/`.

### Data model

- A `book_records` table keyed by the Libib join id, holding title, author, publisher, year, description, cover reference, first-seen time, and last-refreshed time.
- Circulation columns on the book record: copies, out, holds. Availability is derived, not stored, so the rule can change without a migration.
- Tags and Subjects as separate join tables so both can be faceted and counted.
- An `enrichment` table keyed by book record, holding source name, source record id, matched title and author, Rating average, Rating count, page count, and enrichment time.
- A `match_overrides` table keyed by book record, holding the pinned source and source record id; overrides take precedence over automatic matching and are never overwritten by a re-enrichment.
- A `crawl_state` table holding last index poll, cycle cursor, cycle start and finish, backoff state, and last error.
- An FTS5 index over title, author, and description using the trigram tokenizer, so search tolerates substrings and typos. The random sort takes a seed that is carried in the URL.

### Availability rule

- On-shelf copies = copies − out, clamped at zero.
- A book record is Available when on-shelf copies exceed Holds, i.e. a new borrower could take a copy without joining the queue.
- This deliberately differs from Libib's own status, which does not consider what the queue has already claimed. See the glossary definition of Available.

### Libib adapter

- Scrapes the public catalogue without cookies or keys: the paginated index endpoint for the Catalogue index, and a per-book detail endpoint for circulation and metadata.
- The index is 50 book records per page, so the full collection is roughly a dozen requests. Detail is strictly one request per book record.
- The adapter decodes HTML entities in titles and tolerates missing year, publisher, description, and cover.
- Cover images are downloaded once and stored on the volume, served locally; missing images fall back to a placeholder.

### Crawler

- A rolling loop reads one book record every cycle delay (default 30 seconds), completing a Crawl cycle in roughly five hours and then starting again.
- An index poll runs hourly to detect added and removed book records; new records are inserted and immediately queued for their one-time enrichment.
- On 403 or 429 the crawler enters exponential backoff with jitter, records the state for the status endpoint, and resumes from its cursor. It never retries in a tight loop.
- Cycle progress is persisted so a restart resumes rather than restarting the Crawl cycle.
- The scheduling decision is a pure function of the previous outcome and the current backoff state, so it can be tested without sleeping.

### First run, fixtures and recovery

- A fresh database is loaded with fixtures by a seed command; development and the HTTP-seam tests never contact Libib.
- When no catalogue exists in production, First run reads the index, then one detail request per book record at roughly two seconds, writing each record as it arrives. It is resumable from a persisted cursor and is the only deliberate exception to the rolling crawler's pacing.
- After First run and after each completed Crawl cycle, the app writes a consistent snapshot of the database into a snapshots directory on the volume, retaining a configurable number of recent snapshots (default seven).
- A restore command replaces the live database from a chosen snapshot and refuses to run while the crawler is active.
- An export command writes a snapshot to an arbitrary destination for off-host storage. Snapshots contain the database only — including enrichments and Match overrides — because cached covers are content-addressed and cheap to re-fetch.

### Enrichment

- A per-source adapter interface with two operations: search a book record's title and author for a match, and fetch a matched record's Rating, Rating count, Subjects, and page count.
- Open Library ships as the first adapter. Matching requires a normalized title match and an author surname match, and when several works qualify, the one with the most ratings wins, so a graded-reader adaptation does not beat the real work.
- Enrichment runs exactly once per book record, on first sight. There is no schedule.
- CLI commands: enrich for one book, for all unmatched books, for all previously failed books, and for the whole catalogue; export unmatched books as CSV; import Match overrides from CSV. The CSV columns are the book record's join id, source name, source record id or URL, and an optional note.
- Unmatched book records remain visible and are labelled "rating/subjects unknown"; they are excluded from Rating filters and have no Subjects.

### HTTP API

- A book search endpoint accepting: free text, one or more Subjects (OR), one or more Libib tags (OR), author, minimum Rating, an include-low-sample flag, one or more Hold buckets (0, 1–2, 3–5, 6+; OR), an Available-only flag, page-count minimum and maximum, sort field, direction, a random seed when sorting randomly, and an offset and limit.
- The response carries the page of book records, the total matching count, the next offset, and catalogue refresh metadata.
- Categories combine with AND; selections inside a category combine with OR.
- Sorting supports title, author, Rating, Holds, publication year, page count, and random. Null values sort last; random order is stable for a given seed.
- A facets endpoint returns Subjects with counts, Libib tags with counts, and author suggestions.
- A book detail endpoint returns the full book record, its enrichment values, per-book refreshed time, and its Libib link.
- A status endpoint returns last index refresh, current cycle progress, backoff state, and last error.

### Frontend

- Cover grid and table view toggle over the same filter state, with state encoded in the URL.
- Table columns: cover and title, author, Rating with sample size, Holds, availability, Subjects, page count, and copies/out.
- Infinite scroll in batches of roughly two to four dozen records.
- Low-sample Ratings are badged; unmatched book records show "rating/subjects unknown".
- Unavailable book records are shown by default with a badge; an Available-only toggle exists.
- Global "catalogue refreshed" indicator plus per-book refreshed time in the detail view.
- Mobile-first layout: the table collapses to stacked cards on narrow screens.

### Deliberately not decided here

- Mood filtering waits for an enrichment source that supplies moods. The data model should not block adding it later.
- A curated genre taxonomy is not built; raw Subjects are exposed as chosen in ADR-0003.

## Testing Decisions

A good test asserts external behaviour at a seam and survives refactoring of the code behind it. Tests must not reach into private functions, assert HTML markup, or depend on wall-clock timing. Fixtures should be recorded from the real sources so the tests describe the world the code actually meets.

### Seam 1: HTTP API over seeded SQLite

The primary seam. Boot the server against a throwaway SQLite database seeded with a small, deliberately awkward set of book records: matched and unmatched, every Availability case, zero one and many Holds, Ratings across the low-sample boundary, missing year and publisher and page count and cover, entity-encoded titles, and Books whose Subjects overlap. Assert the JSON.

Coverage: free-text search including a typo, filter combinations and their AND/OR semantics, Hold buckets, Available-only, minimum Rating with and without low-sample, page-count range, author filter, every sort field including nulls-last and seeded-random stability, paging and next offset, and the unmatched label.

### Seam 2: Source adapter contracts

Pin the Libib index and detail wire formats and the Open Library search, ratings, and work formats with recorded fixtures. Assert parsed output: entity decoding, missing-field tolerance, pagination, and absent covers. Assert the matching decision separately with crafted candidate sets, including the adaptation-versus-real-work tiebreak, author-surname mismatches, and no-match.

### Seam 3: CLI commands

Run the enrichment and CSV commands against a temporary database with fake adapters. Assert: a book is enriched once and not again unless commanded; an override takes precedence and survives re-enrichment; export-unmatched produces the documented CSV columns; failure states are recorded so a later failed-only run retries them. Also assert the seed command produces a working dataset, and that snapshot then restore round-trips enrichments and Match overrides. First-run resume is asserted by interrupting a fake-adapter run and confirming it continues from the persisted cursor.

### Crawler scheduling

Test the pure scheduling function for normal pacing, backoff entry and growth on 403/429, jitter bounds, recovery after success, and resume from a persisted cursor. No sleeps.

### Prior art

None — the repository is greenfield. These tests establish the conventions: an HTTP-level integration suite using the server's in-process request injection, contract tests driven by recorded fixtures, and CLI tests against a temporary database. Frontend behaviour is covered indirectly through the HTTP contract; no browser tests are in scope for the first cut.

## Out of Scope

- Placing or managing Holds, patron login, Borrowing, loan history, or any patron account features. All of that stays in Libib.
- Any write access to Libib, including the Libib Pro API even if keys become available.
- A curated genre taxonomy, genre merging, or any subject normalization beyond what the enrichment source supplies.
- Mood filters until an enrichment source provides moods.
- Date-added sorting, because Libib's public data does not expose an added date.
- Merging duplicate book records; each Libib record remains a distinct entry.
- Reconciling Ratings across several enrichment sources; only Open Library ships in the first cut.
- Periodic or scheduled enrichment refresh.
- Server-side saved searches or user accounts; sharing is via URL only.
- Email or push notifications for availability or Holds.
- Native mobile applications.
- Multi-context documentation or multi-tenant support.

## Further Notes

- The Collection currently holds 540 book records, and Libib exposes no ISBN publicly. Enrichment matching is therefore title-plus-author, and edition mismatches are expected; the Match override CSV is the escape hatch.
- Libib's robots.txt disallows the public profile path and sets a crawl delay of 30 seconds. The rolling crawler takes that as its pacing budget: about 4.5 to 5 hours per Crawl cycle. This is the accepted trade for not being blocked; see ADR-0002.
- StoryGraph blocks automated requests behind Cloudflare and has no public API. Goodreads book pages are scrapable and carry dense Rating data but are fragile. Hardcover requires a token. Open Library needs no key and is the only source proven reachable; its Ratings are sparse and must always be shown with sample size. See ADR-0004.
- The library's Libib page states that Patrons log in there to place Holds; this page links out to it rather than competing with it.
- Availability deliberately diverges from Libib's own status label, because Libib reports whether a copy exists, not whether the queue has already claimed it. See the glossary definition of Available.
- Enrichment is a one-shot, Librarian-triggered operation by design; Ratings will drift until refreshed. This is accepted; see ADR-0005.
- The issue tracker for this repository is local markdown: specs and issues live under `.scratch/<feature-slug>/`, with triage state recorded as a `Status:` line. See `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`.

## Post-v1 Backlog (pass 2, decided)

Recorded after the v1 prototype and resolved in a grilling round. Tickets 12–19 are `ready-for-agent`. Nothing here is implemented yet.

1. **Libib book links open the book.** Finding: Libib opens an item on initial load via `?solo=<join_id>`, while `?id=` is only handled on browser back/forward — which is why our link lands on the home page. The generated link changes to `?solo=` and is verified against a real book. Ticket 12.
2. **Badges explain themselves.** The glossary defines a **Badge**: a computed label on a book record. Available, Unavailable, Low sample and Unmatched are Badges; Unmatched is driven by enrichment status, not by missing Rating/Subjects. Desktop: hover or keyboard focus reveals the explanation. Touch: a badge can be tapped to reveal its explanation in both the detail view and the grid; tapping a grid badge does not open the book. Fixed copy:
   - Available: *At least one copy is on the shelf and not already claimed by the hold queue.*
   - Unavailable: *Every copy is on loan, or the hold queue has claimed the copies on the shelf.*
   - Low sample: *Based on fewer than five ratings, so the average can be misleading.*
   - Unmatched: *No matching record was found in {source}, so Rating, Subjects and page count are unavailable.* The source name comes from the API. When enrichment failed or has not run, the explanation says enrichment has not completed instead of claiming no match was found; the badge keeps the name "Unmatched".

   Ticket 13.
3. **Filter panel collapses.** Expanded by default, remembered for the session, never encoded in the URL. Ticket 14.
4. **Subjects facet collapses.** Collapsed by default, remembered for the session; while collapsed it shows the selected count, the first two selected names and "+N more". Ticket 15.
5. **Rating and page-count filters clear.** Empty inputs mean no bound; a per-group Clear resets the Rating minimum and both page bounds; 0 stays a meaningful page minimum. Ticket 16.
6. **Detail scroll resets.** Every open starts at the top; no scroll carry-over between books. Ticket 17.
7. **Unmatched filter.** Tri-state All books / Hide unmatched / Only unmatched, default All, using whether enrichment has any data (unmatched, failed, or not yet enriched) and encoded in the URL. Ticket 18.
8. **Enrichment source hints.** Detail view only. An "i" sits next to the Rating heading, the Subjects heading, and a new Page count heading (page count moves out of the Publication body). The source name comes from the API, not hardcoded; the hints render only when the API exposes a source. Tailored copy:
   - Rating: *Sourced from {source}. Ratings may be sparse or describe a different edition.*
   - Subjects: *Sourced from {source}; raw subjects, not genres.*
   - Page count: *Sourced from {source}; may be missing or describe a different edition.*

   No "i" in the grid or table; badges use their own hover/tap explanation instead. Ticket 19.

The original list ended at item 9 with no content; nothing was recorded for it.

## Pass 3 — Production Shape (decided)

Pass 3 turns the pass-2 prototype into the deployable service and supersedes the deferred items above. Tickets 20–26. Nothing here is implemented yet.

### Lifecycle

- **First run** on an empty database: a Catalogue scan, then the Book sweep and a full Enrichment pass in parallel at the normal 30-second pacing. No faster start.
- **Every startup, populated database:** a Catalogue scan, then a full Enrichment pass and the normal Book sweep in parallel. Stored data is served throughout with its refreshed timestamps.
- **Startup cooldown:** a full Enrichment pass is skipped if one completed within the last hour; the timestamp is persisted so restart loops cannot repeat it.
- **Scheduled catalogue scan:** every 24 hours by default, measured from start and configurable (0 disables). It triggers a full Enrichment pass. On failure it retries with backoff, then waits for the next run.
- Enrichment passes cover every visible book, including already-enriched ones; Match overrides always win. A completed manual `enrich --all` records the same cooldown timestamp as a startup or Scheduled pass.

### Data

- `SAMPLE_SIZE`: 0 or unset means the whole Collection; local development sets 50 in a git-ignored `.env.local`, while Compose reads only `.env` and defaults to 0. The Sample is the visible book records it stores and refreshes.
- A book record absent from the full Libib index during a Catalogue scan becomes **Hidden**: excluded from the Crawl set, Enrichment, API and page, with its rows and Match override kept. A record still in Libib but outside a new Sample is retained rather than hidden. A returning record is unhidden and refreshed normally. Switching sample sizes may retain earlier stored records; resetting the database starts clean.
- **Snapshots** are consistent copies of the SQLite database. They are taken after a Catalogue scan, after a full Enrichment pass, after a Match override import, and on demand; the last 10 are kept. Restore requires the app to be stopped (a fresh server heartbeat blocks it); Export copies a fresh snapshot by default or a chosen existing one off-host. Cached covers are excluded.

### Scale and UI

- Infinite scroll in batches of 24, fixed; covers lazy-loaded.

### Deployment

- One container, no catalogue data in the image. `DATA_DIR` (default `./data`) is bind-mounted at `/data` and holds the database, covers and snapshots.
- The container serves plain HTTP on container port `3000`, published on all interfaces at host port `3002`, with a healthcheck. A host-run reverse proxy (Tailscale Funnel now, Cloudflare later) routes the site's hostname to port `3002` and terminates TLS.

### Site analytics

- First-party and cookieless: no third-party script, no cookies, no consent banner and no stored IPs. Collection is server-side from requests the app already receives, with a small first-party beacon for outbound clicks, share use, filter resets and scroll depth. Unique visitors are an approximate daily count from a salted IP+User-Agent hash with a daily-rotated salt.
- A public `/analytics` page shows aggregates only: visits, approximate unique visitors, humans vs Bots, devices/browser/OS, referrers, most-viewed books and event totals. No Search text.
- Raw Search text and detailed breakdowns are produced on demand as an HTML and CSV report for the Librarian. Analytics tables live in `catalogue.sqlite`, so Snapshots, Exports and Restores include them. Raw retention defaults to forever and is configurable. See ADR-0011.

### Commands

Canonical CLI: `catalogue:scan`, `catalogue:resample`, `sweep` (`--book`, `--delay`), `enrich` (`--all`, `--unmatched`, `--failed`, `--id`), `snapshot`, `restore`, `export`, `overrides:import`, `export:unmatched`, `seed`, plus `dev`, `build`, `start`, `test`, `typecheck`. All are documented in the operations documentation.

### Decisions recorded

ADR-0007 (First run and scheduled scans), ADR-0008 (deployment), ADR-0009 (enrichment cadence), ADR-0010 (snapshots), ADR-0011 (Site analytics), ADR-0012 (publish on all interfaces). ADR-0005, ADR-0006 and ADR-0008 are superseded.

## Pass 4 — Implemented

Tickets 27, 30, 31, 32 and 34 are implemented. Dependencies were 30 → 31 and 32; 30 and 32 → 34; 27 independent. Unscheduled ideas live in `BACKLOG.md` so they do not enter pass planning.

1. **Filter by multiple authors — ticket 27.** Replace the author text box with a searchable multi-select. The facet splits Libib author strings on `&` and `,`, trims, dedupes, groups case-insensitively and shows counts. An empty search shows every author; typing filters the options. Selections combine as OR, match co-authored strings and are encoded in the URL. No separate free-text author filter.
2. **Enrichment status and run log — ticket 30.** Add the shared run log (kind, trigger, status, start/finish, duration, counts, error, note) used by every job. Expose the last full Enrichment pass, counts by status, in-progress state, next run and last error; run history is served only by the paginated `/api/runs` endpoint. Expose a book's `enrichedAt`.
3. **Enrichment source link — ticket 31.** The detail view shows the source name, a link to the matched record and the enriched-at time; unmatched books explain the absence. No report-correction feature; readers contact the Librarian directly.
4. **Book sweep completion and failures — ticket 32.** Record sweep cycles in the run log, expose the last completed cycle and current progress with an estimate and stalled flag, keep a per-book sweep ledger with reasons, and provide an audit list/CSV that distinguishes unswept zeroes from genuinely empty records.
5. **Status page — ticket 34.** A public, read-only `/status` page renders current state and run history for Catalogue scan, Enrichment pass, Book sweep, Snapshot, Restore, Export and Override import, lazy-loading 20 rows per section. Linked from the footer; no auth, no writes, no raw stdout.

These entries are the decision record. Exact acceptance criteria and API/schema shapes live in the tickets; durable architectural choices live in the ADRs.

## Pass 5 — Planned

Tickets 35–43. Nothing implemented. 37 and 38 are decided; 41's copy needs maintainer review; 42 moves publishing to host port 3002; 43 adds Site analytics. The rest are ready.

1. **Back to top button — ticket 35.** A control appears after scrolling and returns smoothly to the top.
2. **Header links to Libib — ticket 36.** The "Open House Library" label opens `https://www.libib.com/u/openhouselibrary` in a new tab.
3. **Sweep audit worklist — ticket 37.** Keep the cumulative "no successful sweep" list, add an explicit attempted/never-attempted column, and document that it reflects the latest attempt per book; per-cycle history stays in the run log.
4. **Copy-link — ticket 38.** Keep the button and add an HTTP-safe fallback with visible success/failure feedback.
5. **Remove the "Not yet swept" message — ticket 39.** Remove the message from the detail view; the sweep state stays in the API and `/status`.
6. **Include low-sample ratings by default — ticket 40.** The "Include low sample ratings" checkbox is checked by default.
7. **GitHub link and Terms page — ticket 41.** Footer links to the repository and a public `/terms` page covering what the site is, data sources and freshness, no accounts or tracking, cookieless aggregate Site analytics with a `/analytics` link, external links, no warranty, corrections and contact, licence status and last-updated date. Draft copy for maintainer review; no licence is asserted (the licence decision lives in `BACKLOG.md`).
8. **Publish on all interfaces — ticket 42.** Compose publishes `0.0.0.0:3002` to container port `3000`; Tailscale Funnel and a future Cloudflare ingress target port `3002`. ADR-0012 supersedes ADR-0008's loopback binding.
9. **Site analytics — ticket 43.** First-party, cookieless collection with no stored IPs: server-side capture of Visits, Searches, Zero-result searches, Filter use, sort use, Book views, 404s and API errors, referrer, device/browser/OS and a UA-based human-vs-Bot split, plus a small beacon for outbound clicks, share use, filter resets and scroll depth. Public `/analytics` shows aggregates without Search text; raw Search text lives in an on-demand HTML and CSV report for the Librarian. Analytics tables live in `catalogue.sqlite`; raw retention defaults to forever and is configurable. App logs redact IPs and query strings.
