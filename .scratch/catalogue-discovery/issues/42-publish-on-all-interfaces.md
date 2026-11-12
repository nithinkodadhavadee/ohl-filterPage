# 42: Publish the container on all interfaces on host port 3002

**What to build:** Publish the app on all interfaces at host port `3002`, mapped
to container port `3000`. Compose becomes `"0.0.0.0:3002:3000"`. The container
keeps `PORT=3000`, so the Dockerfile and healthcheck do not change.

The server already runs a service on `3000`, and the site is currently reached
through Tailscale Funnel and will later move to Cloudflare. Both reverse proxies
target the host's port `3002`. ADR-0012 records this and supersedes ADR-0008's
loopback requirement.

**Blocked by:** None

**Status:** ready-for-agent

**Note:** The site is read-only and has no auth; publishing on all interfaces
means LAN and tailnet hosts can reach it directly, with firewall/network policy
as the boundary. That is a deliberate trade-off. The git-ignored
`docker-compose.override.yml` currently pins `0.0.0.0:3000`; update or delete it
or it will override the new default locally.

- [ ] `docker-compose.yml` publishes `0.0.0.0:3002` to container `3000`.
- [ ] Container `PORT`, the Dockerfile and the healthcheck stay on `3000`.
- [ ] The local `docker-compose.override.yml` is updated or removed.
- [ ] `README.md`, `docs/docker.md` and `docs/operations.md` use host port
      `3002`, including Tailscale Funnel/Serve commands; the "do not deploy the
      override" note is rewritten.
- [ ] ADR-0012 is referenced and ADR-0008 is marked superseded.
- [ ] `docker compose config --quiet` validates.
- [ ] `docker compose up -d` serves `/health` on `127.0.0.1:3002` and from
      another machine on the LAN/tailnet.
