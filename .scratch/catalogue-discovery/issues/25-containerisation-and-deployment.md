# 25: Containerisation and deployment

**What to build:** A Dockerfile and Compose file run the whole app as one container with no catalogue data in the image. `DATA_DIR` (default `./data`) is bind-mounted at `/data` and holds the database, covers and snapshots; environment variables configure the port, sample size, sweep pacing and scan interval. A healthcheck covers the app and crawler status. The container serves plain HTTP on a loopback port; a single host-run Cloudflare Tunnel, shared across projects, routes the site's hostname to it.

**Blocked by:** 21, 22, 23, 24

**Status:** done (static verification; Docker unavailable on the implementing machine)

- [ ] `docker compose up` builds and starts the app, and `/health` reports healthy.
- [ ] An empty volume triggers First run; a populated volume serves immediately and catches up in the background.
- [ ] Database, covers and snapshots survive container replacement via the bind mount.
- [ ] Every environment variable is documented, and `SAMPLE_SIZE` defaults to the whole Collection.
- [ ] The Cloudflare Tunnel ingress rule and the loopback publication are documented; the container handles no TLS.
- [ ] The image contains no catalogue data.

## Comments

- Added `HOST` (default `127.0.0.1`) so the process can bind `0.0.0.0` inside the
  container while the host publication stays on `127.0.0.1:3000`.
- Docker is not installed on the implementing machine. The Dockerfile, Compose
  file, image stages and healthcheck were validated statically only; the image
  build, `docker compose up` and the live healthcheck remain unverified.
