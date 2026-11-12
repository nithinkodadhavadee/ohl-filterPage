import { useEffect, useState } from 'react';
import type {
  AnalyticsBreakdown,
  AnalyticsSummary,
} from '../shared/analytics';
import { fetchAnalyticsSummary } from './api';
import { SiteFooter } from './SiteFooter';

function BreakdownTable({
  title,
  rows,
  emptyLabel = 'No data yet.',
}: {
  title: string;
  rows: AnalyticsBreakdown[];
  emptyLabel?: string;
}) {
  return (
    <section className="status-section" aria-labelledby={`analytics-${title}`}>
      <div className="status-section-head">
        <h2 id={`analytics-${title}`}>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <table className="analytics-table">
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function eventCount(summary: AnalyticsSummary, kind: string): number {
  return summary.events.find((entry) => entry.label === kind)?.count ?? 0;
}

export function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Open House Library — analytics';
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchAnalyticsSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load analytics',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page status-page analytics-page">
      <header className="site-header">
        <div>
          <p className="eyebrow">Open House Library</p>
          <h1>Site analytics</h1>
          <p className="refresh-note">
            Cookieless, first-party aggregates. Unique visitor counts are
            approximate daily estimates. No Search text appears here.
          </p>
        </div>
        <a className="back-link" href="/">
          ← Back to catalogue
        </a>
      </header>

      <main>
        {error ? (
          <div className="status status-error" role="alert">
            <p>{error}</p>
          </div>
        ) : !summary ? (
          <p className="status" role="status">
            Loading analytics…
          </p>
        ) : (
          <>
            <section className="status-section" aria-labelledby="analytics-overview">
              <div className="status-section-head">
                <h2 id="analytics-overview">Overview</h2>
                <p className="muted">
                  Since collection began. Unique visitors are approximate.
                </p>
              </div>
              <dl className="analytics-stats">
                <div>
                  <dt>Visits</dt>
                  <dd>{summary.pageViews.total}</dd>
                </div>
                <div>
                  <dt>Humans</dt>
                  <dd>{summary.humans}</dd>
                </div>
                <div>
                  <dt>Bots</dt>
                  <dd>{summary.bots}</dd>
                </div>
                <div>
                  <dt>Searches</dt>
                  <dd>{summary.searches.total}</dd>
                </div>
                <div>
                  <dt>Zero-result searches</dt>
                  <dd>{summary.searches.zeroResults}</dd>
                </div>
                <div>
                  <dt>Book views</dt>
                  <dd>{eventCount(summary, 'book_view')}</dd>
                </div>
              </dl>
            </section>

            <section className="status-section" aria-labelledby="analytics-daily">
              <div className="status-section-head">
                <h2 id="analytics-daily">Daily visits</h2>
                <p className="muted">
                  Unique visitors are approximate. Latest 30 days with activity.
                </p>
              </div>
              {summary.daily.length === 0 ? (
                <p className="muted">No visits recorded yet.</p>
              ) : (
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th scope="col">Day (UTC)</th>
                      <th scope="col">Visits</th>
                      <th scope="col">Approx. unique visitors</th>
                      <th scope="col">Bots</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.daily.map((day) => (
                      <tr key={day.day}>
                        <td>{day.day}</td>
                        <td>{day.visits}</td>
                        <td>
                          {day.uniqueVisitors}{' '}
                          <span className="muted">(approx.)</span>
                        </td>
                        <td>{day.bots}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {summary.mostViewedBooks.length > 0 ? (
              <section className="status-section" aria-labelledby="analytics-books">
                <div className="status-section-head">
                  <h2 id="analytics-books">Most-viewed books</h2>
                </div>
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Views</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.mostViewedBooks.map((book) => (
                      <tr key={book.joinId}>
                        <td>
                          <a href={`/?book=${encodeURIComponent(book.joinId)}`}>
                            {book.title}
                          </a>
                        </td>
                        <td>{book.views}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}

            <BreakdownTable title="Pages" rows={summary.pageViews.byPath} />
            <BreakdownTable title="Devices (humans)" rows={summary.devices} />
            <BreakdownTable title="Browsers (humans)" rows={summary.browsers} />
            <BreakdownTable
              title="Operating systems (humans)"
              rows={summary.operatingSystems}
            />
            <BreakdownTable title="Referrers" rows={summary.referrers} />
            <BreakdownTable title="Event totals" rows={summary.events} />
          </>
        )}
      </main>

      <SiteFooter label="Open House Library analytics" />
    </div>
  );
}
