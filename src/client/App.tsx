import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBooks, fetchStatus } from './api';
import type { Book, BooksResponse, CrawlerStatus } from './types';

function formatDate(value: string | null): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function initialOf(title: string): string {
  return title.trim().charAt(0).toUpperCase() || '?';
}

function crawlerHealth(status: CrawlerStatus | null): {
  label: string;
  tone: 'ok' | 'warn' | 'off';
} {
  if (!status) return { label: 'Crawler status unknown', tone: 'off' };
  if (!status.enabled) return { label: 'Crawler paused', tone: 'off' };
  if (status.backoff.active) {
    return {
      label: `Crawler backing off (attempt ${status.backoff.attempt})`,
      tone: 'warn',
    };
  }
  if (status.lastOutcome === 'error') {
    return { label: 'Crawler needs attention', tone: 'warn' };
  }
  if (status.cycle.total === 0) {
    return { label: 'Crawler waiting for a sample', tone: 'off' };
  }
  return {
    label: `Crawler ${status.cycle.position}/${status.cycle.total} this cycle`,
    tone: 'ok',
  };
}

function Cover({ book }: { book: Book }) {
  const [failed, setFailed] = useState(false);

  if (book.coverUrl && !failed) {
    return (
      <img
        className="cover-image"
        src={book.coverUrl}
        alt={`Cover of ${book.title}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className="cover-placeholder" aria-hidden="true">
      <span>{initialOf(book.title)}</span>
    </div>
  );
}

function AvailabilityBadge({ book }: { book: Book }) {
  return (
    <span
      className={`availability-badge ${book.available ? 'is-available' : 'is-unavailable'}`}
    >
      {book.available ? 'Available' : 'Unavailable'}
    </span>
  );
}

function BookDetail({ book }: { book: Book }) {
  const unmatched = book.rating === null && book.subjects.length === 0;

  return (
    <div className="detail-layout">
      <div className="detail-cover">
        <Cover book={book} />
      </div>
      <div className="detail-main">
        <h2 id="detail-title">{book.title}</h2>
        <p className="detail-author">{book.author || 'Author unknown'}</p>

        <div className="detail-badges">
          <AvailabilityBadge book={book} />
          {book.rating?.lowSample ? (
            <span className="sample-badge">Low sample</span>
          ) : null}
        </div>

        <section className="detail-section" aria-labelledby="detail-circulation">
          <h3 id="detail-circulation">Circulation</h3>
          <dl className="circulation-grid">
            <div>
              <dt>Copies</dt>
              <dd>{book.copies}</dd>
            </div>
            <div>
              <dt>Out</dt>
              <dd>{book.out}</dd>
            </div>
            <div>
              <dt>Holds</dt>
              <dd>{book.holds}</dd>
            </div>
            <div>
              <dt>On shelf</dt>
              <dd>{book.onShelf}</dd>
            </div>
          </dl>
        </section>

        <section className="detail-section" aria-labelledby="detail-publication">
          <h3 id="detail-publication">Publication</h3>
          <p>
            {book.publisher ?? 'Publisher unknown'}
            <span aria-hidden="true"> · </span>
            {book.year ?? 'Year unknown'}
          </p>
          <p className="muted">
            {book.pageCount !== null
              ? `${book.pageCount} pages`
              : 'Page count unknown'}
          </p>
        </section>

        <section className="detail-section" aria-labelledby="detail-description">
          <h3 id="detail-description">Description</h3>
          <p>{book.description ?? 'No description available.'}</p>
        </section>

        <section className="detail-section" aria-labelledby="detail-rating">
          <h3 id="detail-rating">Rating</h3>
          {unmatched ? (
            <p className="unknown-note">rating/subjects unknown</p>
          ) : book.rating ? (
            <p>
              {book.rating.average.toFixed(2)} / 5
              <span className="muted">
                {' '}
                ({book.rating.count}{' '}
                {book.rating.count === 1 ? 'rating' : 'ratings'})
              </span>
            </p>
          ) : (
            <p className="muted">No rating yet.</p>
          )}
        </section>

        <section className="detail-section" aria-labelledby="detail-tags">
          <h3 id="detail-tags">Libib tags</h3>
          {book.tags.length > 0 ? (
            <ul className="chip-list">
              {book.tags.map((tag) => (
                <li key={tag} className="chip">
                  {tag}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No tags.</p>
          )}
        </section>

        <section className="detail-section" aria-labelledby="detail-subjects">
          <h3 id="detail-subjects">Subjects</h3>
          {book.subjects.length > 0 ? (
            <ul className="chip-list">
              {book.subjects.map((subject) => (
                <li key={subject} className="chip chip-subject">
                  {subject}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No subjects.</p>
          )}
        </section>

        <footer className="detail-footer">
          <p className="muted">
            This record refreshed {formatDate(book.refreshedAt)}
          </p>
          <a
            className="libib-link"
            href={book.libibUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on Libib
          </a>
        </footer>
      </div>
    </div>
  );
}

export function App() {
  const [catalogue, setCatalogue] = useState<BooksResponse | null>(null);
  const [status, setStatus] = useState<CrawlerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Book | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [books, crawler] = await Promise.all([
        fetchBooks(),
        fetchStatus().catch(() => null),
      ]);
      setCatalogue(books);
      setStatus(crawler);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the catalogue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) {
      dialog.showModal();
    } else if (!selected && dialog.open) {
      dialog.close();
    }
  }, [selected]);

  const closeDetail = () => {
    dialogRef.current?.close();
    setSelected(null);
  };

  const books = catalogue?.items ?? [];
  const health = crawlerHealth(status);

  return (
    <div className="page">
      <header className="site-header">
        <div>
          <p className="eyebrow">Open House Library</p>
          <h1>Catalogue</h1>
        </div>
        <div className="header-status">
          <p className="refresh-note">
            Catalogue refreshed{' '}
            <strong>
              {formatDate(catalogue?.meta.lastIndexRefreshedAt ?? null)}
            </strong>
          </p>
          <p
            className={`crawler-health is-${health.tone}`}
            title={status?.lastError ?? undefined}
          >
            <span className="crawler-dot" aria-hidden="true" />
            {health.label}
          </p>
        </div>
      </header>

      <main>
        {loading ? (
          <p className="status" role="status">
            Loading catalogue…
          </p>
        ) : error ? (
          <div className="status status-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </div>
        ) : books.length === 0 ? (
          <p className="status">
            No books yet. Run <code>npm run seed</code> to load fixtures.
          </p>
        ) : (
          <>
            <p className="result-count">
              {catalogue?.total ?? 0}{' '}
              {(catalogue?.total ?? 0) === 1 ? 'book' : 'books'}
            </p>
            <ul className="book-grid">
              {books.map((book) => (
                <li key={book.joinId}>
                  <button
                    type="button"
                    className="book-card"
                    onClick={() => setSelected(book)}
                    aria-label={`${book.title}${book.author ? ` by ${book.author}` : ''}`}
                  >
                    <Cover book={book} />
                    <span className="book-card-title">{book.title}</span>
                    <span className="book-card-author">
                      {book.author || 'Author unknown'}
                    </span>
                    <span className="book-card-meta">
                      <AvailabilityBadge book={book} />
                      <span className="book-card-holds">
                        Holds: {book.holds}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      <dialog
        ref={dialogRef}
        className="detail-dialog"
        aria-labelledby="detail-title"
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDetail();
        }}
      >
        {selected ? (
          <>
            <button
              type="button"
              className="detail-close"
              onClick={closeDetail}
              aria-label="Close details"
            >
              ×
            </button>
            <BookDetail book={selected} />
          </>
        ) : null}
      </dialog>
    </div>
  );
}
