# 37: Review the sweep audit CSV

**What to build:** Decide what the sweep audit CSV is for. Today it lists every book with no successful sweep; never-attempted books have empty `last_attempt_at`, `outcome` and `reason`, which is correct but makes the file look like a bare book list. Options: keep it as a "no successful sweep" worklist and document that empty means never attempted; restrict it to failed/skipped after a completed cycle; add an explicit `attempted` / `never attempted` column; or remove it if the /status page covers the need.

**Blocked by:** None (discussion first)

**Status:** needs-triage

- [ ] Decide the purpose of the audit and who reads it.
- [ ] Decide the columns and whether never-attempted rows belong.
- [ ] Update the audit output, /status link and ticket 32 wording to match.
