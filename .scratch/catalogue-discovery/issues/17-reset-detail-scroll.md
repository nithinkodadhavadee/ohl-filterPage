# 17: Reset detail scroll on open

**What to build:** Opening a second book must start its detail view at the top. The previous book's scroll position must never carry over, whether the Patron closed the view or opened another book from a permalink.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Every newly opened book detail starts scrolled to the top.
- [ ] Scrolling one book and then opening a different book does not inherit that position.
- [ ] Closing and reopening the same book also starts at the top.
- [ ] Opening a detail directly from a `?book=` permalink also starts at the top.
