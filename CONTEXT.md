# Open House Library Discovery

A read-only, public discovery layer over the Open House Library's Libib catalogue, letting members search and filter the collection without touching Libib's lending system.

## People

**Patron**:
A member of the library who browses the catalogue and borrows through Libib.
_Avoid_: User, member, customer

**Librarian**:
The person who maintains the catalogue and lending in Libib, and who administers this page.
_Avoid_: Staff, administrator, admin

## Catalogue

**Collection**:
A named grouping of book records inside Libib. This library has one, "Books".
_Avoid_: Library, shelf, category

**Book record**:
One entry in the Libib catalogue. A book record may stand for several physical copies.
_Avoid_: Item, title, listing, entry

**Hidden book**:
A book record no longer present in Libib, kept in the database but excluded from the Crawl set, the API and the page. It becomes visible again if it reappears.
_Avoid_: Deleted book, removed book

**Copy**:
A single physical volume of a book record. Only counts are known, never individual copies.
_Avoid_: Unit, instance

**Libib tag**:
A label the librarian attached to a book record inside Libib. Coarse and authored by the library, unlike a Subject.
_Avoid_: Genre, category, subject

## Circulation

**Out**:
Copies of a book record currently on loan.
_Avoid_: Borrowed, checked out

**On shelf**:
Copies of a book record that are not currently on loan.
_Avoid_: In stock, available copies

**Hold**:
A patron's request for a book record, tracked in a queue by Libib. Only the queue length is known here.
_Avoid_: Reservation, request, waitlist

**Available**:
A book record is available when the copies on shelf outnumber the holds, so a new borrower could take one without waiting. Otherwise it is unavailable, even if copies exist physically.
_Avoid_: In stock, borrowable

**Borrowing**:
Checking a copy out of the library. It happens in Libib, never here.
_Avoid_: Lending

## Enrichment

**Enrichment**:
Book data obtained from a source other than Libib — chiefly rating, subjects, and page count.
_Avoid_: Metadata, hydration

**Enriched book**:
A book record with a confirmed match to a record in an enrichment source.
_Avoid_: Matched book

**Unmatched book**:
A book record whose enrichment search returned no confirmed match. It is shown as "rating/subjects unknown". A record that failed or has not been enriched yet is not unmatched; it simply has no enrichment data.
_Avoid_: Failed book, missing book

**Subject**:
A raw topical label supplied by an enrichment source. Subjects overlap, repeat at different granularities, and are not a genre taxonomy.
_Avoid_: Genre, category, tag

**Rating**:
An enrichment source's average reader score together with the number of contributions behind it. A rating resting on fewer than five contributions is low-sample.
_Avoid_: Score, stars, review

**Match override**:
A librarian-supplied correction that pins a book record to a specific enrichment record.
_Avoid_: Manual match, fix

## Freshness

**Catalogue index**:
The list of book records — their titles, authors, covers, and existence. Cheap to refresh.
_Avoid_: Inventory

**Refreshed**:
The last time the library's own figures for a book record — holds, copies, availability — were read. Refreshing is per book record, not per site.
_Avoid_: Synced, updated

**Sweep cycle**:
One full pass of the Book sweep over the Crawl set.
_Avoid_: Crawl cycle, sync, run

## Operations

**Catalogue scan**:
Reading Libib's catalogue index to establish which book records exist — titles, authors and covers — adding new records and removing records that have vanished.
_Avoid_: Index, poll, sync

**Book sweep**:
The rolling refresh of one book record's circulation and library metadata at a steady pace, cycling through the Crawl set.
_Avoid_: Refresh, crawl, index

**Enrichment pass**:
Fetching Ratings, Subjects and page count from an enrichment source for book records that need them.
_Avoid_: Enrichment crawl, metadata sync

**First run**:
The initial sequence on an empty database: a Catalogue scan, then the Book sweep and Enrichment pass in parallel.
_Avoid_: Bootstrap

**Scheduled catalogue scan**:
A Catalogue scan triggered on a timer to detect added and removed book records.
_Avoid_: Poll, poller, index poll

**Crawl set**:
The set of book records the Book sweep covers. In production it is the whole Collection; locally it may be a Sample.
_Avoid_: Inventory

**Sample**:
A deliberately capped Crawl set used for local development, chosen by the `SAMPLE_SIZE` environment variable. A Sample limits what a Catalogue scan stores and refreshes, not what exists in Libib: switching sample sizes may retain earlier stored records, and resetting the database starts clean.
_Avoid_: Fixture set, subset

**Snapshot**:
A consistent copy of the catalogue database, taken so data can be restored without re-scanning or re-enriching.
_Avoid_: Backup, dump

## Presentation

**Badge**:
A computed label attached to a book record for display — Available, Unavailable, Low sample, or unmatched. Not authored by the Librarian.
_Avoid_: Tag, label, status

## Analytics

**Site analytics**:
Aggregate, cookieless observations about how Patrons use the public pages.
_Avoid_: Tracking, telemetry, user analytics

**Visit**:
One load of a public page (`/` or `/status`) by an anonymous browser.
_Avoid_: Pageview, hit, session

**Unique visitor**:
An approximate count of distinct daily visitor hashes; not a person and not a persistent identifier.
_Avoid_: User, unique user, visitor ID

**Bot**:
A request identified by User-Agent as an automated client, counted separately and excluded from Patron metrics.
_Avoid_: Crawler, spider

**Search**:
A catalogue query with a text term, recorded once when it settles.
_Avoid_: Query, keyword search

**Zero-result search**:
A Search that returned no book records.
_Avoid_: Failed search, empty search

**Filter use**:
Applying a filter facet to narrow the catalogue.
_Avoid_: Filter event, facet click

**Book view**:
Opening a book record's detail view.
_Avoid_: Detail view, book click

**Outbound click**:
A click that leaves the site for Libib, GitHub or the Terms page.
_Avoid_: Exit click, external link

**Librarian report**:
An on-demand HTML and CSV export of detailed Site analytics, shared privately with the Librarian.
_Avoid_: Dashboard, export
