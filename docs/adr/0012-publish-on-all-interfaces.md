# Publish the container on all interfaces on host port 3002

ADR-0008 published the container on loopback so only the tunnel could reach the
origin. The deployment now runs behind Tailscale Funnel and will later move to
Cloudflare, and the host already has a service on port 3000. Compose publishes
`0.0.0.0:3002` to container port `3000`; the container still listens on `3000`
internally, and the reverse proxy (Tailscale Funnel now, Cloudflare later)
targets the host's port 3002. This supersedes ADR-0008's loopback requirement;
the rest of ADR-0008 (one container, no catalogue data in the image, a host-run
reverse proxy terminating TLS) still stands.

## Consequences

- The origin is reachable from the LAN and tailnet, not only through the proxy;
  network and firewall policy become the boundary.
- The site remains read-only and has no auth, so LAN exposure is a deliberate
  trade-off.
- The documented `3000` references, the Compose file and the git-ignored local
  override must move to `3002`.
