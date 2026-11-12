import { useCallback, useEffect, useRef, useState } from 'react';
import type { EnrichmentStatusSummary } from '../shared/contract';
import type {
  RunKind,
  RunLogEntry,
  RunStatus,
} from '../shared/run-log';
import { fetchRunHistory, fetchStatus } from './api';
import { formatDateTime } from './format';
import {
  RUN_HISTORY_PAGE_SIZE,
  STATUS_SECTIONS,
  appendRunHistory,
  countEntries,
  formatRemaining,
  formatRunDuration,
  formatRunStatus,
  latestRun,
  type StatusSection,
} from './status-data';
import type { CrawlerStatus, StatusResponse } from './types';

function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={`run-status is-${status}`}>{formatRunStatus(status)}</span>
  );
}

function RunCounts({ run }: { run: RunLogEntry }) {
  const entries = countEntries(run.counts);
  if (entries.length === 0) return null;

  return (
    <dl className="run-counts">
      {entries.map((entry) => (
        <div key={entry.key}>
          <dt>{entry.label}</dt>
          <dd>{entry.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RunSummary({ run }: { run: RunLogEntry }) {
  const label = run.status === 'running' ? 'Current run' : 'Last run';
  const finishedLabel = run.finishedAt
    ? formatDateTime(run.finishedAt)
    : run.status === 'running'
      ? 'In progress'
      : '—';

  return (
    <div className={`run-summary${run.status === 'running' ? ' is-live' : ''}`}>
      <div className="run-summary-head">
        <div>
          <p className="run-kicker">{label}</p>
          <p className="run-trigger">Triggered {run.trigger}</p>
        </div>
        <RunStatusBadge status={run.status} />
      </div>

      <dl className="run-summary-meta">
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(run.startedAt)}</dd>
        </div>
        <div>
          <dt>Finished</dt>
          <dd>{finishedLabel}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd>{formatRunDuration(run.duration)}</dd>
        </div>
      </dl>

      <RunCounts run={run} />

      {run.error ? (
        <p className="run-error" role="alert">
          {run.error}
        </p>
      ) : null}
      {run.note ? <p className="run-note">Note: {run.note}</p> : null}
    </div>
  );
}

function RunHistoryRow({ run }: { run: RunLogEntry }) {
  return (
    <li className="run-history-row">
      <div className="run-history-head">
        <RunStatusBadge status={run.status} />
        <span className="run-trigger">{run.trigger}</span>
        <time dateTime={run.startedAt}>{formatDateTime(run.startedAt)}</time>
        <span className="run-duration">
          {formatRunDuration(run.duration)}
        </span>
      </div>
      <RunCounts run={run} />
      {run.finishedAt ? (
        <p className="run-finished">
          Finished {formatDateTime(run.finishedAt)}
        </p>
      ) : null}
      {run.error ? <p className="run-error">{run.error}</p> : null}
      {run.note ? <p className="run-note">Note: {run.note}</p> : null}
    </li>
  );
}

function RunHistory({ kind }: { kind: RunKind }) {
  const [runs, setRuns] = useState<RunLogEntry[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadFirstPage = useCallback(async () => {
    const request = requestRef.current + 1;
    requestRef.current = request;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchRunHistory(kind, {
        limit: RUN_HISTORY_PAGE_SIZE,
      });
      if (requestRef.current !== request) return;
      setRuns(page.runs);
      setNextOffset(page.nextOffset);
    } catch (loadError) {
      if (requestRef.current !== request) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load run history',
      );
    } finally {
      if (requestRef.current === request) setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = async () => {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchRunHistory(kind, {
        limit: RUN_HISTORY_PAGE_SIZE,
        offset: nextOffset,
      });
      setRuns((current) => appendRunHistory(current, page));
      setNextOffset(page.nextOffset);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load more run history',
      );
    } finally {
      setLoadingMore(false);
    }
  };

  const lastRun = latestRun(runs);

  if (loading) {
    return <p className="status">Loading history…</p>;
  }

  if (error && runs.length === 0) {
    return (
      <div className="status status-error" role="alert">
        <p>{error}</p>
        <button type="button" onClick={() => void loadFirstPage()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <>
      {lastRun ? (
        <RunSummary run={lastRun} />
      ) : (
        <p className="status">No runs recorded yet.</p>
      )}

      {runs.length > 0 ? (
        <>
          <h3 className="run-history-title">History</h3>
          <ol className="run-history-list">
            {runs.map((run) => (
              <RunHistoryRow key={run.id} run={run} />
            ))}
          </ol>
        </>
      ) : null}

      {error ? (
        <p className="status status-error" role="alert">
          {error}
        </p>
      ) : null}

      {nextOffset !== null ? (
        <button
          type="button"
          className="load-more-runs"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? 'Loading…' : `Load ${RUN_HISTORY_PAGE_SIZE} more`}
        </button>
      ) : runs.length > 0 ? (
        <p className="muted run-history-end">End of history.</p>
      ) : null}
    </>
  );
}

function EnrichmentPanel({
  enrichment,
}: {
  enrichment: EnrichmentStatusSummary;
}) {
  const { counts } = enrichment;

  return (
    <div className="status-panel">
      <h3>Enrichment status</h3>
      <dl className="panel-meta">
        <div>
          <dt>Last full pass</dt>
          <dd>{formatDateTime(enrichment.lastFullPassAt)}</dd>
        </div>
        <div>
          <dt>Next scheduled</dt>
          <dd>{formatDateTime(enrichment.nextScheduledRunAt)}</dd>
        </div>
        <div>
          <dt>In progress</dt>
          <dd>{enrichment.inProgress ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
      <dl className="count-summary">
        <div>
          <dt>Enriched</dt>
          <dd>{counts.enriched}</dd>
        </div>
        <div>
          <dt>Unmatched</dt>
          <dd>{counts.unmatched}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{counts.failed}</dd>
        </div>
        <div>
          <dt>Pending</dt>
          <dd>{counts.pending}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{counts.total}</dd>
        </div>
      </dl>
      {enrichment.lastError ? (
        <p className="run-error" role="alert">
          {enrichment.lastError}
        </p>
      ) : null}
    </div>
  );
}

function SweepPanel({ status }: { status: CrawlerStatus }) {
  const { cycle, lastCycle } = status;
  const percent =
    cycle.total > 0 ? Math.min(100, (cycle.position / cycle.total) * 100) : 0;

  return (
    <div className="status-panel">
      <h3>Sweep progress</h3>
      <p className="sweep-progress-label">
        {cycle.total > 0
          ? `${cycle.position} of ${cycle.total} books this cycle`
          : 'No sweep cycle is running.'}
      </p>
      {cycle.total > 0 ? (
        <progress
          className="sweep-progress"
          value={cycle.position}
          max={cycle.total}
        >
          {percent}%
        </progress>
      ) : null}
      <dl className="panel-meta">
        <div>
          <dt>Estimate</dt>
          <dd>{formatRemaining(cycle.estimatedRemainingMs, cycle.stalled)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{formatDateTime(cycle.startedAt)}</dd>
        </div>
        <div>
          <dt>Last outcome</dt>
          <dd>{status.lastOutcome ?? '—'}</dd>
        </div>
        <div>
          <dt>Last cycle</dt>
          <dd>
            {lastCycle.finishedAt
              ? `${formatDateTime(lastCycle.finishedAt)} (${formatRunDuration(lastCycle.duration)})`
              : 'No completed cycle yet'}
          </dd>
        </div>
      </dl>
      {cycle.stalled ? (
        <p className="run-error" role="alert">
          The sweep has stopped making progress.
        </p>
      ) : null}
      {status.lastError ? (
        <p className="run-error" role="alert">
          {status.lastError}
        </p>
      ) : null}
      <p className="sweep-audit-link">
        <a href="/api/sweep/audit.csv" download>
          Download books without a successful sweep (CSV)
        </a>
      </p>
      <p className="muted">
        A cumulative worklist of visible books with no successful sweep yet. It
        shows each book&rsquo;s latest attempt, including books never attempted;
        per-cycle history is in the run history above.
      </p>
    </div>
  );
}

function SectionPanel({
  section,
  status,
}: {
  section: StatusSection;
  status: StatusResponse;
}) {
  switch (section.panel) {
    case 'enrichment':
      return <EnrichmentPanel enrichment={status.enrichment} />;
    case 'sweep':
      return <SweepPanel status={status} />;
    default:
      return null;
  }
}

export function StatusPage() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Open House Library — Status';
    let cancelled = false;

    fetchStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setStatusError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load status',
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page status-page">
      <header className="site-header">
        <div>
          <p className="eyebrow">Open House Library</p>
          <h1>Status</h1>
          <p className="refresh-note">
            Current jobs and run history. This page is read-only.
          </p>
        </div>
        <a className="back-link" href="/">
          ← Back to catalogue
        </a>
      </header>

      {statusError ? (
        <div className="status status-error" role="alert">
          <p>{statusError}</p>
        </div>
      ) : null}

      <main>
        {STATUS_SECTIONS.map((section) => (
          <section
            className="status-section"
            key={section.kind}
            aria-labelledby={`status-${section.kind}`}
          >
            <div className="status-section-head">
              <h2 id={`status-${section.kind}`}>{section.label}</h2>
              <p className="muted">{section.description}</p>
            </div>

            {status ? (
              <SectionPanel section={section} status={status} />
            ) : null}

            <RunHistory kind={section.kind} />
          </section>
        ))}
      </main>

      <footer className="site-footer">
        <p className="muted">Open House Library</p>
        <a href="/">Catalogue</a>
      </footer>
    </div>
  );
}
