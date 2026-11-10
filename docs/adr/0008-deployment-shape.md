# Deploy as one container behind a host-run Cloudflare Tunnel

The app ships as a single container with no catalogue data in the image; the SQLite database, cached covers and snapshots live in a host folder bind-mounted at `/data` (default `./data`, overridden with `DATA_DIR`). The container serves plain HTTP on a loopback port, and a single host-run `cloudflared` instance shared by all projects routes the site's hostname to that port; Cloudflare terminates TLS.

## Consequences

- Backups are ordinary file copies on the host.
- No per-project tunnel container and no certificates inside the image.
- Restoring means stopping the container, replacing the database, and starting again.
- Binding the published port to loopback keeps the origin unreachable except through the tunnel.
