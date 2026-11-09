# 12: Fix the Libib book permalink

**What to build:** The "View on Libib" control must open the specific book, not the library home page. Finding: Libib opens an item on initial load via `?solo=<join_id>`, while `?id=` is only handled on browser back/forward — which is why the current link lands on the home page. Change the generated Libib URL to `?solo=<join_id>` and verify a real book opens in a browser.

**Blocked by:** None (can start immediately)

**Status:** done (pass 2)

- [ ] Every book's Libib link uses `?solo=<join_id>`.
- [ ] Opening one real book's link lands on that book, not the home page.
- [ ] The join id is encoded safely in the URL.
- [ ] No other navigation behaviour changes.
