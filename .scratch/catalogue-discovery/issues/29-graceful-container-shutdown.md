# 29: Run Node directly so container shutdown is graceful

**What to build:** The container currently runs `npm start`, so Docker signals npm rather than the application. On `docker compose stop`, npm reports `signal SIGTERM` and the container exits 1; the server's shutdown handler never logs its message and never releases the server lock. Run the Node server directly as PID 1, and harden the shutdown handler so it always releases the lock and exits cleanly even if closing fails. A graceful stop should leave the database intact and ready to resume.

**Blocked by:** None (can start immediately)

**Status:** done (pass 3 follow-up)

- [ ] The container command runs the Node server directly, not through npm.
- [ ] `docker compose stop` exits 0 and the logs show the application receiving SIGTERM.
- [ ] The server lock is removed on a graceful stop.
- [ ] If closing the app or stopping the Book sweep throws, the lock is still released and the process exits 0.
- [ ] Rebuilding and stopping the container in Docker verifies the exit code and lock cleanup.
- [ ] Local `npm start` still works.
