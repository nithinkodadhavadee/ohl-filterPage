# Collect Site analytics in-app, cookieless, with public aggregates and private reports

The site is public and read-only, has no accounts, and the Terms page promises no
tracking cookies. We collect Site analytics first-party inside the app rather
than adding an analytics service: Visits, Searches, Zero-result searches, Filter
use, sort use, Book views, outbound clicks, share use and scroll depth, plus
referrer, device/browser/OS and a UA-based human-vs-Bot split. Collection is
server-side from requests the app already receives, with a tiny first-party
beacon only for outbound clicks, share, filter resets and scroll. There are no
cookies and no persistent identifiers; unique visitors are an approximate daily
count from a salted IP+User-Agent hash whose salt is rotated daily and discarded,
so no IP is stored. The public `/analytics` page shows aggregates without Search
text; raw Search text appears only in an on-demand HTML and CSV report prepared
for the Librarian. Analytics tables live in `catalogue.sqlite` and raw retention
defaults to forever, configurable later.

## Considered Options

- **Umami, GoatCounter, Plausible CE, Swetrix:** privacy-friendly and
  cookieless, but each adds a service and dashboard, and most filter Bots rather
  than reporting them. Structured raw Search text also fits awkwardly into the
  lighter tools.
- **GoAccess over server logs:** the best human-vs-Bot truth, but it cannot see
  client-side search/filter/outbound/scroll events and needs a separate access
  log format.
- **A hosted service:** rejected for data ownership and because Bot splitting is
  weak or absent.

## Consequences

- Snapshots, Exports and Restores include analytics and raw Search text because
  they share `catalogue.sqlite`.
- A Restore rolls analytics back to the snapshot point; a later raw purge cannot
  reach older snapshots.
- The Bot split is a User-Agent heuristic, not behavioural detection.
- The app must trust the reverse proxy's client-IP header for unique counts to
  be meaningful behind Tailscale Funnel or Cloudflare.
- The public page reveals aggregate community interest, including most-viewed
  books, but never Search text.
