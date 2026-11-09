# 03: Per-book circulation, availability and detail view

**What to build:** Every book record carries its circulation and publication facts, and Patrons can open a detail view. Copies, Out, Holds, publisher, year, description, Libib tags, the derived Available badge, per-book refreshed time and a Libib link all appear, alongside a global catalogue refreshed indicator.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] A per-book read captures Copies, Out, Holds, publisher, year, description and Libib tags, plus a last-refreshed timestamp.
- [ ] Available is derived as on-shelf copies exceeding Holds and is consistent in the grid and detail view.
- [ ] The detail view shows description, publisher and year, Copies/Out/Holds, Libib tags, last-refreshed time and the Libib link.
- [ ] A global indicator shows when the Catalogue index was last refreshed.
- [ ] Missing publisher, year, description or tags are tolerated rather than failing the read.
