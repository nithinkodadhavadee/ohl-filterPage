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
A book record with no confirmed enrichment match. It is shown as "rating/subjects unknown".
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

**Crawl cycle**:
One full pass over every book record in the catalogue.
_Avoid_: Sync, run

## Presentation

**Badge**:
A computed label attached to a book record for display — Available, Unavailable, Low sample, or unmatched. Not authored by the Librarian.
_Avoid_: Tag, label, status
