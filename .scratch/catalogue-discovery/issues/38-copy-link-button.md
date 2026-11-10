# 38: Fix or remove the copy-link button

**What to build:** Decide the fate of the copy-link button in the book detail view. Root cause of the breakage: `navigator.clipboard.writeText` requires a secure context, so it works on `localhost` but silently does nothing when the app is opened over plain HTTP through the LAN or Tailscale address. Options: remove the button if it is not worth keeping; keep it and add a fallback copy path that works over HTTP; or serve the site over HTTPS. Do not leave a control that silently does nothing.

**Blocked by:** None (discussion first)

**Status:** needs-triage

- [ ] Decide whether the button is needed at all.
- [ ] If kept, copying works over both HTTP and HTTPS, with visible success/failure feedback.
- [ ] If removed, no dead control remains and the permalink can still be shared another way.
