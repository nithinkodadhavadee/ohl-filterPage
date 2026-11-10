# 34: Status page

**What to build:** A public, read-only `/status` page that renders current state and run history from the shared run log. Sections: Catalogue scan, Enrichment pass, Book sweep, Snapshot, Restore, Export and Override import. Each section shows the current or last run (status, start/finish, duration, counts, error) and its history, loading 20 rows at a time until exhausted. Link it from the main page footer. No authentication, no write actions and no raw stdout logs.

**Blocked by:** 30, 32

**Status:** ready-for-agent

- [ ] `/status` renders every section and shows the current/last run plus history.
- [ ] History lazy-loads 20 rows per section until there are no more.
- [ ] Failures and successful runs are both visible, with error text where present.
- [ ] The page is linked from the main page footer and works on mobile.
- [ ] There is no auth, no write action and no raw stdout log stream.
- [ ] Tests cover the route and the history pagination helpers.
