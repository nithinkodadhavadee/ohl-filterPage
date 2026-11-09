# 16: Clear Rating and page-count filters

**What to build:** A Patron can clear the Rating and page-count filters with one per-group action instead of typing 0 into each box. Empty inputs mean no bound, and 0 remains a meaningful value where it applies (page minimum).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Empty Rating and page-count inputs mean "no bound".
- [ ] A per-group Clear resets the Rating minimum and both page-count bounds in one step.
- [ ] 0 remains a real value for the page-count minimum.
- [ ] The control is disabled or hidden when those filters are already empty.
- [ ] The URL and results update without a manual reload.
