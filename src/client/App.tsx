import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBooks, fetchStatus } from './api';
import type {
  Book,
  BooksResponse,
  CrawlerStatus,
  SortDirection,
  SortField,
} from './types';

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

function isUnmatched(book: Book): boolean {
  return book.rating === null && book.subjects.length === 0;
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
  const unmatched = isUnmatched(book);

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
              {book.rating.lowSample ? (
                <span className="sample-badge sample-badge-inline">
                  Low sample
                </span>
              ) : null}
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
          {unmatched ? (
            <p className="unknown-note">rating/subjects unknown</p>
          ) : book.subjects.length > 0 ? (
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

const SORT_FIELDS: SortField[] = [
  'relevance',
  'title',
  'author',
  'holds',
  'year',
  'random',
];

interface ViewState {
  q: string;
  sort: SortField;
  direction: SortDirection;
  seed: string | null;
}

function createSeed(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultDirection(sort: SortField): SortDirection {
  return sort === 'relevance' ? 'desc' : 'asc';
}

function parseViewState(search: string): ViewState {
  const params = new URLSearchParams(search);
  const q = (params.get('q') ?? '').trim();
  const rawSort = params.get('sort');
  let sort: SortField = q ? 'relevance' : 'title';

  if (rawSort && (SORT_FIELDS as string[]).includes(rawSort)) {
    sort = rawSort as SortField;
  }
  if (!q && sort === 'relevance') sort = 'title';

  const rawDirection = params.get('direction');
  const direction: SortDirection =
    rawDirection === 'asc' || rawDirection === 'desc'
      ? rawDirection
      : defaultDirection(sort);

  return { q, sort, direction, seed: params.get('seed') };
}

function ensureSeed(view: ViewState): ViewState {
  if (view.sort === 'random' && !view.seed) {
    return { ...view, seed: createSeed() };
  }
  return view;
}

function viewToUrl(view: ViewState): string {
  const params = new URLSearchParams();
  if (view.q) params.set('q', view.q);
  params.set('sort', view.sort);
  params.set('direction', view.direction);
  if (view.sort === 'random' && view.seed) params.set('seed', view.seed);
  const search = params.toString();
  return search
    ? `${window.location.pathname}?${search}`
    : window.location.pathname;
}

export function App() {
  const [view, setView] = useState<ViewState>(() =>
    ensureSeed(parseViewState(window.location.search)),
  );
  const [catalogue, setCatalogue] = useState<BooksResponse | null>(null);
  const [status, setStatus] = useState<CrawlerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Book | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const updateView = useCallback(
    (next: ViewState, options: { push?: boolean } = {}) => {
      setView(next);
      const url = viewToUrl(next);
      if (options.push) {
        window.history.pushState(null, '', url);
      } else {
        window.history.replaceState(null, '', url);
      }
    },
    [],
  );

  useEffect(() => {
    if (view.sort === 'random') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('seed') !== view.seed) {
        window.history.replaceState(null, '', viewToUrl(view));
      }
    }
  }, [view]);

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((crawler) => {
        if (!cancelled) setStatus(crawler);
      })
      .catch(() => {
        // Status is best-effort; the catalogue must still render.
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  useEffect(() => {
    const onPopState = () => {
      const next = ensureSeed(parseViewState(window.location.search));
      setView(next);
      if (next.sort === 'random') {
        const params = new URLSearchParams(window.location.search);
        if (params.get('seed') !== next.seed) {
          window.history.replaceState(null, '', viewToUrl(next));
        }
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBooks({
      q: view.q || undefined,
      sort: view.sort,
      direction: view.direction,
      seed: view.sort === 'random' ? view.seed ?? undefined : undefined,
      limit: 200,
      offset: 0,
    })
      .then((data) => {
        if (!cancelled) setCatalogue(data);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load the catalogue',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [view, reloadToken]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected && !dialog.open) {
      dialog.showModal();
    } else if (!selected && dialog.open) {
      dialog.close();
    }
  }, [selected]);

  const handleSearchChange = (value: string) => {
    let sort = view.sort;
    let direction = view.direction;

    if (value.trim() === '') {
      if (sort === 'relevance') {
        sort = 'title';
        direction = 'asc';
      }
    } else if (sort === 'title' || sort === 'relevance') {
      if (sort !== 'relevance') direction = 'desc';
      sort = 'relevance';
    }

    updateView({ ...view, q: value, sort, direction });
  };

  const handleSortChange = (value: string) => {
    const sort = value as SortField;
    let direction = view.direction;

    if (sort === 'relevance') {
      direction = 'desc';
    } else if (view.sort === 'relevance') {
      direction = 'asc';
    }

    const seed =
      sort === 'random' && !view.seed ? createSeed() : view.seed;

    updateView({ ...view, sort, direction, seed }, { push: true });
  };

  const toggleDirection = () => {
    updateView(
      {
        ...view,
        direction: view.direction === 'asc' ? 'desc' : 'asc',
      },
      { push: true },
    );
  };

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
        <section className="controls" aria-label="Search and sort">
          <label className="search-field">
            <span className="visually-hidden">
              Search title, author or description
            </span>
            <input
              type="search"
              value={view.q}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder="Search title, author or description"
              autoComplete="off"
            />
          </label>
          <div className="sort-controls">
            <label>
              <span>Sort by</span>
              <select
                value={view.sort}
                onChange={(event) => handleSortChange(event.target.value)}
              >
                {view.q.trim() ? (
                  <option value="relevance">Relevance</option>
                ) : null}
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="holds">Holds</option>
                <option value="year">Year</option>
                <option value="random">Random</option>
              </select>
            </label>
            <button
              type="button"
              className="direction-toggle"
              onClick={toggleDirection}
              aria-label={`Sort ${view.direction === 'asc' ? 'ascending' : 'descending'}`}
            >
              {view.direction === 'asc' ? 'Ascending ↑' : 'Descending ↓'}
            </button>
          </div>
        </section>

        {loading ? (
          <p className="status" role="status">
            Loading catalogue…
          </p>
        ) : error ? (
          <div className="status status-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setReloadToken((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : books.length === 0 ? (
          <p className="status">
            {view.q.trim() ? (
              'No books match your search.'
            ) : (
              <>
                No books yet. Run <code>npm run seed</code> to load fixtures.
              </>
            )}
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
                    {book.rating ? (
                      <span className="book-card-rating">
                        ★ {book.rating.average.toFixed(1)}
                        <span className="book-card-rating-count">
                          {' '}
                          ({book.rating.count})
                        </span>
                        {book.rating.lowSample ? (
                          <span className="sample-badge sample-badge-inline">
                            Low sample
                          </span>
                        ) : null}
                      </span>
                    ) : isUnmatched(book) ? (
                      <span className="book-card-rating is-unknown">
                        rating/subjects unknown
                      </span>
                    ) : null}
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
