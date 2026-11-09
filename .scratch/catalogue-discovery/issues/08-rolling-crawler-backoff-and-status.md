# 08: Rolling crawler, backoff and status

**What to build:** Circulation refreshes itself without operator action. A rolling Crawl cycle keeps Holds and availability current over the frozen sample, the crawler backs off gracefully when Libib pushes back, and the page keeps working from the last good data. The hourly index poll is deferred pending discussion.

**Blocked by:** 03

**Status:** done (v1 prototype)

**Needs conversation:** the hourly index poll and its interaction with a frozen sample.

- [ ] A background loop reads one book record roughly every 30 seconds, completing a Crawl cycle over the 50-book sample in about 25 minutes and repeating.
- [ ] On 403 or 429 the crawler backs off exponentially with jitter and resumes, never retrying in a tight loop.
- [ ] The page keeps serving the last good snapshot while the crawler is backing off.
- [ ] A status surface reports cycle progress, last index refresh, backoff state and last error.
- [ ] A restart resumes from the persisted cursor rather than restarting the cycle.
- [ ] No hourly index poll runs in v1; the sample stays frozen between manual resamples.
