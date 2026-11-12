# 37: Review the sweep audit CSV

**What to build:** Keep the audit as a cumulative **"no successful sweep"**
worklist and make its meaning explicit. The ledger holds one row per book
(`last_attempt_at`, `outcome`, `reason`, `last_success_at`) and is upserted on
every attempt, so the CSV reflects the latest attempt per book, not a history of
cycles. A book that failed days ago still appears until it succeeds; a book that
has never been attempted appears with blank attempt fields.

Add an explicit `attempted` / `never-attempted` column rather than relying on
empty cells, and document that older failures superseded by a later attempt are
not retained here — per-cycle history belongs to the run log. Update the
`/status` link and ticket 32 wording to match.

**Blocked by:** None (pass 5)

**Status:** implemented (pass 5, pending end-to-end QA)

- [x] Decide the purpose of the audit and who reads it: a cumulative worklist for
      the Librarian of visible books with no successful sweep.
- [x] Decide the columns: add `attempted` / `never-attempted`; keep join id,
      title, author, last attempt, outcome and reason.
- [ ] Update the audit output, `/status` link and ticket 32 wording to match.
- [ ] Tests cover a never-attempted book, a failed book and a book that
      succeeded after failing.
