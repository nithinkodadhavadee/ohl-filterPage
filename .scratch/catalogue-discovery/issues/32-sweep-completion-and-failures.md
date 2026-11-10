# 32: Book sweep completion and failures

**What to build:** Record every Book sweep cycle in the shared run log and record a per-book sweep ledger: `join_id`, last attempt time, outcome (`refreshed` / `skipped` / `failed`) and reason. Expose the last completed cycle's start, finish and duration; the current position, total and estimated remaining time; a stalled flag; and the last error. Provide an audit list or CSV of books with no successful sweep, and let the page distinguish a record that has never been swept (Copies/Out/Holds still at their zero defaults) from a genuinely empty record. Do not add sleep-specific behaviour; the laptop is a development device and the server stays on.

**Blocked by:** 30 (uses the run log)

**Status:** done (pass 4)

- [ ] Each sweep cycle writes a run-log row with position, total and refreshed/skipped/failed counts.
- [ ] `/api/status` exposes last completed cycle start/finish/duration, current progress, estimated remaining, a stalled flag and last error.
- [ ] Each book records its last attempt, outcome and reason.
- [ ] An audit endpoint or CSV lists books with no successful sweep, excluding Hidden books.
- [ ] The UI can distinguish unswept zeroes from genuinely empty records.
- [ ] Tests cover the run row, status shape, ledger and audit output.
