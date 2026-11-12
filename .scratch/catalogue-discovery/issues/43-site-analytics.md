# 43: Site analytics

**What to build:** A first-party, cookieless Site analytics subsystem inside the
app. No third-party script, no extra containers, no dashboard, no cookies and no
stored IPs. The public `/analytics` page shows aggregates only; detailed data
including raw Search text is produced on demand as an HTML and CSV report for
the Librarian.

**Capture — server-side, from requests the app already receives:**

- **Visit:** a document load of `/` or `/status`. Exclude `/health`, `/covers`,
  `/api/*`, `/analytics`, `/terms` and assets.
- **Search:** a non-empty text query on `/api/books` at `offset=0`; record the
  raw query, the active filters and sort, the result count, and whether it was a
  **Zero-result search**. Record once per settled query, not per pagination
  request.
- **Filter use** and **sort use:** when those parameters change at `offset=0`.
- **Book view:** `/api/books/:joinId`, plus direct `?solo=` opens.
- **404s and API errors:** any API response with status >= 400.
- **Referrer:** host of the `Referer` header on a Visit; no full URL.
- **Device, browser, OS:** derived from User-Agent. Do not store the raw
  User-Agent.
- **Bot:** a server-side User-Agent + known-crawler classifier. Count Bots
  separately and exclude them from Patron metrics. Heuristic, not behavioural
  detection.
- **Unique visitor:** a salted hash of IP + User-Agent computed at request time;
  store only the hash. Rotate the salt daily and discard it. The IP is never
  written.

**Capture — tiny first-party beacon:**

- `POST /api/analytics/event`, rate-limited, accepting only:
  - `outbound` — destination `libib`, `github` or `terms`;
  - `share` — success or failure of the copy-link action;
  - `filter_reset`;
  - `scroll` — quartile 25/50/75/100 once per Book view.
- The beacon carries no query text and no identifiers. Validate and drop
  unknown event types or oversized payloads.

**Storage:** analytics tables in the existing `catalogue.sqlite`, accepted
deliberately. Snapshots, Exports and Restores therefore include analytics and
raw Search text.

**Privacy:** no cookies, no localStorage identifiers, no consent banner, no IP
storage. Redact `remoteAddress` and strip query strings from the app's request
logs so Docker/journald do not hold IPs or Search text. Configure trusted-proxy
handling for Tailscale Funnel and the future Cloudflare ingress and verify the
real client IP reaches the app before trusting unique counts.

**Public `/analytics`:** a direct-load route like `/status`, showing page views,
approximate daily unique visitors, humans vs Bots, devices/browser/OS, referrers,
most-viewed books and per-event totals. **No Search text.** Label approximate
metrics as approximate. No auth.

**Private detail:** `npm run analytics:report -- [--since <date>] [--until <date>] [--out <dir>]`
writes an HTML report and a CSV to `DATA_DIR/reports/` (or `--out`). Includes raw
Search text, Zero-result searches, filter/sort usage, most-viewed books,
outbound/share/scroll events, referrers, Bots and devices. Shared manually with
the Librarian; nothing is exposed publicly.

**Retention:** `ANALYTICS_RETENTION_DAYS`, default `0` meaning keep raw data
forever. Aggregates must remain valid if raw data is later purged. Revisit the
period with the Librarian.

**Blocked by:** 41 (the Terms page must disclose analytics)

**Status:** ready-for-agent

**Note:** Do not add a third-party analytics script, a cookie, a consent banner,
a dashboard or an IP column. Bot classification stays a UA heuristic. The same-
database decision means snapshots carry raw Search text; do not strip them
without revisiting the ticket.

- [ ] Analytics tables added to the schema.
- [ ] Server-side capture covers Visits, Searches, Zero-result searches, Filter
      use, sort use, Book views, `?solo=` opens, 404s/API errors, referrer,
      device/browser/OS, Bot flag and the daily visitor hash.
- [ ] Salt rotates daily; no IP or raw User-Agent is stored.
- [ ] Beacon accepts only the four event types, is rate-limited, and carries no
      query text or identifiers.
- [ ] App request logs redact `remoteAddress` and query strings.
- [ ] Trusted-proxy handling verified behind Funnel and documented for
      Cloudflare.
- [ ] `/analytics` renders on direct load and shows only the approved
      aggregates, with no Search text.
- [ ] `npm run analytics:report` writes HTML and CSV with raw Search text and the
      detailed breakdown, honouring date range and output directory.
- [ ] Retention defaults to forever and is configurable.
- [ ] Ticket 41's Terms copy discloses cookieless aggregate analytics.
- [ ] Tests cover capture, aggregation, the public/private split (no Search text
      publicly), beacon validation and log redaction.
- [ ] `typecheck`, `build` and `test` pass.
