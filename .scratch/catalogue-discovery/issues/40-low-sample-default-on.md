# 40: Include low-sample ratings by default

**What to build:** The "Include low sample ratings" checkbox should be checked by default, so rating filters include low-sample ratings unless the Patron unchecks it. Update the default view state, URL handling and tests.

**Blocked by:** None (pass 5)

**Status:** ready-for-agent

- [ ] The checkbox is checked on a fresh load with no URL override.
- [ ] Rating filters include low-sample ratings by default.
- [ ] Unchecking excludes them, and the choice round-trips through the URL.
- [ ] Tests cover the default and the explicit off state.
