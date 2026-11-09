# 13: Badge explanations

**What to build:** Available, Unavailable, Low sample and Unmatched are **Badges** (see CONTEXT.md) and explain their rule on interaction. Desktop: hover or keyboard-focus the badge itself. Touch: badges in the detail view are tappable; tapping a badge on a grid card still opens the book. The Unmatched label becomes a Badge driven by the authoritative enrichment status, not by missing Rating/Subjects. No separate "i" control is added for badges.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The four Badges share one component and these texts: Available — "At least one copy is on the shelf and not already claimed by the hold queue."; Unavailable — "Every copy is on loan, or the hold queue has claimed the copies on the shelf."; Low sample — "Based on fewer than five ratings, so the average can be misleading."; Unmatched — "No matching record was found in Open Library, so Rating, Subjects and page count are unavailable."
- [ ] Desktop hover and keyboard focus reveal the explanation.
- [ ] In the detail view a tap reveals the explanation on touch devices.
- [ ] On a grid card, tapping a badge still opens the book rather than showing the explanation.
- [ ] Unmatched is rendered as a Badge from enrichment status, in grid, table and detail view.
