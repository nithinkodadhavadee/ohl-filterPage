# 01: Walking skeleton

**What to build:** A TypeScript application serving locally that renders the discovery page from a seeded SQLite database. Seeded book records flow through the HTTP API into a responsive cover grid, with a health endpoint, a seed command for fixtures, and the HTTP-seam test harness in place. This establishes the primary testing seam every later ticket builds on; containerisation is deferred.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The app starts locally with a documented command, serves the discovery page and a health endpoint, and needs no container.
- [ ] A seed command loads fixture book records into an empty database, and development never contacts Libib.
- [ ] Seeded book records appear in a responsive cover grid showing title, author and cover or placeholder.
- [ ] The HTTP API returns book records in a documented JSON shape.
- [ ] The HTTP-seam test harness runs against seeded fixtures and passes.
