# 38: Fix or remove the copy-link button

**What to build:** Keep the copy-link button and make it work over both HTTPS and
plain HTTP. `navigator.clipboard.writeText` requires a secure context, so it
works on localhost/HTTPS but silently does nothing over plain HTTP. Add an
HTTP-safe fallback (a selectable input or `document.execCommand('copy')`), and
show visible success or failure feedback either way. Do not leave a control that
silently does nothing.

**Blocked by:** None (pass 5)

**Status:** ready-for-agent

- [x] Decide whether the button is needed: keep it.
- [ ] Copying works over both HTTP and HTTPS, with visible success/failure
      feedback.
- [ ] Tests or a manual check cover the fallback path.
