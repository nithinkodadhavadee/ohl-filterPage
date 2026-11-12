# 39: Remove the "Not yet swept" message

**What to build:** Remove the message "Not yet swept — Copies, Out and Holds are still the zero defaults." from the book detail view. The sweep ledger and per-book sweep state stay in the API and /status; only the message is unwanted. Note the trade-off: without it, an unswept zero looks like a genuine zero on the page.

**Blocked by:** None (pass 5)

**Status:** implemented (pass 5, pending end-to-end QA)

- [ ] The message is gone from the detail view.
- [ ] No layout or spacing is left behind.
- [ ] The sweep state remains available in the API and /status.
- [ ] Tests that asserted the message are updated.
