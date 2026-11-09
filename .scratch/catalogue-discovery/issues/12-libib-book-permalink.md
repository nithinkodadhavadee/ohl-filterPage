# 12: Fix the Libib book permalink

**What to build:** The "View on Libib" control should open the specific book, not the library home page. Libib appears to redirect shared item links to the collection page. Investigate the public page's `solo` and `id` parameters, and use a stable item permalink if one exists; if none does, replace the control with a clear explanation so it no longer promises a deep link.

**Blocked by:** None (can start immediately)

**Status:** needs-info

- [ ] Determine whether any Libib URL opens the item directly (candidates: `?solo=<join_id>`, `?id=<join_id>`), and record the finding.
- [ ] If a working permalink exists, use it everywhere a book links to Libib, and verify it on desktop and mobile.
- [ ] If no working permalink exists, remove or relabel the control rather than linking to the home page.
