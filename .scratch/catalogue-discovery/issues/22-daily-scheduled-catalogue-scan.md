# 22: Daily Scheduled catalogue scan

**What to build:** A timer runs a Catalogue scan every 24 hours by default, measured from app start and configurable, followed by a full Enrichment pass. On failure it retries with backoff, then waits for the next run; the Book sweep keeps serving stored data.

**Blocked by:** 21

**Status:** ready-for-agent

- [ ] The interval defaults to 24 hours, is environment-configurable, and 0 disables the scheduled scan.
- [ ] A successful Scheduled catalogue scan triggers a full Enrichment pass.
- [ ] A failed scan retries with backoff and then waits for the next run.
- [ ] The status endpoint reports the last run, the next run and the last error.
