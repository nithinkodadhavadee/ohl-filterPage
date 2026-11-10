# 32: Report Book sweep completion and per-book failures

**What to build:** The only sweep signal today is the current cycle position. There is no last-completed time, no failure or skip ledger, and no way to tell a book that has not been swept yet from one where Libib returned no detail. Expose the last completed cycle's start, finish and duration; the current cycle's position, total and estimated remaining time; a stall indicator; and a per-book sweep outcome (refreshed, skipped, failed) with a timestamp and reason. Provide a Librarian list or CSV of books that still have no successful sweep after a cycle, and mark records whose Copies/Out/Holds are still at their unswept zero values.

**Blocked by:** None (next-pass candidate)

**Status:** needs-triage

- [ ] `/api/status` exposes the last completed cycle's start, finish and duration, the current progress and an estimated remaining time, the last error and a stalled flag.
- [ ] Each book records its last sweep attempt time, outcome (`refreshed` / `skipped` / `failed`) and reason.
- [ ] A full cycle can be audited: a list or CSV of books without a successful sweep, with the reason.
- [ ] "0 copies / 0 out / 0 holds" can be distinguished between a genuinely empty record and a record that has never been swept.
- [ ] Hidden books are excluded.
- [ ] Tests cover the status shape, the ledger and the audit export.
