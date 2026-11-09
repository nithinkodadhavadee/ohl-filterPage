# 13: Badge explanations

**What to build:** Available, Unavailable, Low sample and Unmatched are **Badges** (see CONTEXT.md) and explain their rule on interaction. Desktop: hover or keyboard-focus the badge itself. Touch: badges are tappable in the detail view and on grid cards; tapping a grid badge reveals its explanation without opening the book. The Unmatched badge is driven by the authoritative enrichment status, not by missing Rating/Subjects. No separate "i" control is added for badges.

**Blocked by:** None (can start immediately)

**Status:** done (pass 2)

- [ ] The four Badges share one component and these texts: Available — "At least one copy is on the shelf and not already claimed by the hold queue."; Unavailable — "Every copy is on loan, or the hold queue has claimed the copies on the shelf."; Low sample — "Based on fewer than five ratings, so the average can be misleading."; Unmatched — "No matching record was found in {source}, so Rating, Subjects and page count are unavailable.", where {source} comes from the API (neutral fallback when unknown).
- [ ] Desktop hover and keyboard focus reveal the explanation.
- [ ] A tap reveals the explanation on touch devices, in the detail view and on grid cards.
- [ ] On a grid card, tapping a badge reveals the explanation rather than opening the book.
- [ ] Unmatched is rendered as a Badge from enrichment status, in grid, table and detail view.
- [ ] For failed or not-yet-enriched books the explanation says enrichment has not completed, not that no match was found.
