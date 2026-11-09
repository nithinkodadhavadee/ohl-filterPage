import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBooks, fetchFacets, fetchStatus } from './api';
import type {
  Book,
  BooksResponse,
  CrawlerStatus,
  FacetsResponse,
  HoldBucket,
  SortDirection,
  SortField,
  ViewMode,
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
  'rating',
  'pageCount',
  'random',
];

const HOLD_BUCKETS: HoldBucket[] = ['0', '1-2', '3-5', '6+'];

const HOLD_BUCKET_LABELS: Record<HoldBucket, string> = {
  '0': 'None (0)',
  '1-2': '1–2',
  '3-5': '3–5',
  '6+': '6 or more',
};

function BookTable({
  books,
  onSelect,
}: {
  books: Book[];
  onSelect: (book: Book) => void;
}) {
  return (
    <table className="book-table">
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Author</th>
          <th scope="col">Rating</th>
          <th scope="col">Holds</th>
          <th scope="col">Availability</th>
          <th scope="col">Subjects</th>
          <th scope="col">Pages</th>
          <th scope="col">Copies / Out</th>
        </tr>
      </thead>
      <tbody>
        {books.map((book) => (
          <tr key={book.joinId}>
            <td className="cell-title">
              <button
                type="button"
                className="table-title-button"
                onClick={() => onSelect(book)}
                aria-label={`${book.title}${book.author ? ` by ${book.author}` : ''}`}
              >
                <span className="table-cover">
                  <Cover book={book} />
                </span>
                <span className="table-title-text">{book.title}</span>
              </button>
            </td>
            <td data-label="Author">{book.author || 'Author unknown'}</td>
            <td data-label="Rating">
              {book.rating ? (
                <span className="rating-cell">
                  ★ {book.rating.average.toFixed(2)}
                  <span className="muted"> ({book.rating.count})</span>
                  {book.rating.lowSample ? (
                    <span className="sample-badge sample-badge-inline">
                      Low sample
                    </span>
                  ) : null}
                </span>
              ) : isUnmatched(book) ? (
                <span className="muted">rating/subjects unknown</span>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td data-label="Holds">{book.holds}</td>
            <td data-label="Availability">
              <AvailabilityBadge book={book} />
            </td>
            <td data-label="Subjects">
              {book.subjects.length > 0 ? (
                book.subjects.join(', ')
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td data-label="Pages">
              {book.pageCount !== null ? (
                book.pageCount
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td data-label="Copies / Out">
              {book.copies} / {book.out}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface ViewState {
  q: string;
  sort: SortField;
  direction: SortDirection;
  seed: string | null;
  author: string;
  tags: string[];
  subjects: string[];
  holds: HoldBucket[];
  availableOnly: boolean;
  ratingMin: string;
  includeLowSample: boolean;
  pagesMin: string;
  pagesMax: string;
  view: ViewMode;
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

  const tags = [...new Set(params.getAll('tag').filter(Boolean))];
  const subjects = [...new Set(params.getAll('subject').filter(Boolean))];
  const holds = [
    ...new Set(
      params
        .getAll('holds')
        .filter((value): value is HoldBucket =>
          (HOLD_BUCKETS as string[]).includes(value),
        ),
    ),
  ];

  return {
    q,
    sort,
    direction,
    seed: params.get('seed'),
    author: params.get('author') ?? '',
    tags,
    subjects,
    holds,
    availableOnly:
      params.get('available') === '1' || params.get('available') === 'true',
    ratingMin: params.get('rating_min') ?? '',
    includeLowSample:
      params.get('include_low_sample') === '1' ||
      params.get('include_low_sample') === 'true',
    pagesMin: params.get('pages_min') ?? '',
    pagesMax: params.get('pages_max') ?? '',
    view: params.get('view') === 'table' ? 'table' : 'grid',
  };
}

function activeFilterCount(view: ViewState): number {
  return (
    (view.author.trim() ? 1 : 0) +
    view.tags.length +
    view.subjects.length +
    view.holds.length +
    (view.availableOnly ? 1 : 0) +
    (view.ratingMin.trim() ? 1 : 0) +
    (view.includeLowSample ? 1 : 0) +
    (view.pagesMin.trim() ? 1 : 0) +
    (view.pagesMax.trim() ? 1 : 0)
  );
}

function numberOrUndefined(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  if (view.author.trim()) params.set('author', view.author.trim());
  for (const tag of view.tags) params.append('tag', tag);
  for (const subject of view.subjects) params.append('subject', subject);
  for (const bucket of view.holds) params.append('holds', bucket);
  if (view.availableOnly) params.set('available', '1');
  if (view.ratingMin.trim()) params.set('rating_min', view.ratingMin.trim());
  if (view.includeLowSample) params.set('include_low_sample', '1');
  if (view.pagesMin.trim()) params.set('pages_min', view.pagesMin.trim());
  if (view.pagesMax.trim()) params.set('pages_max', view.pagesMax.trim());
  if (view.view === 'table') params.set('view', 'table');
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
  const [facets, setFacets] = useState<FacetsResponse | null>(null);
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
    let cancelled = false;
    fetchFacets()
      .then((data) => {
        if (!cancelled) setFacets(data);
      })
      .catch(() => {
        // Facets are best-effort; search and the grid still work without them.
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
      author: view.author.trim() || undefined,
      tags: view.tags,
      subjects: view.subjects,
      holds: view.holds,
      availableOnly: view.availableOnly,
      ratingMin: numberOrUndefined(view.ratingMin),
      includeLowSample: view.includeLowSample,
      pagesMin: numberOrUndefined(view.pagesMin),
      pagesMax: numberOrUndefined(view.pagesMax),
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

  const handleAuthorChange = (author: string) => {
    updateView({ ...view, author });
  };

  const toggleTag = (tag: string) => {
    const tags = view.tags.includes(tag)
      ? view.tags.filter((entry) => entry !== tag)
      : [...view.tags, tag];
    updateView({ ...view, tags }, { push: true });
  };

  const toggleSubject = (subject: string) => {
    const subjects = view.subjects.includes(subject)
      ? view.subjects.filter((entry) => entry !== subject)
      : [...view.subjects, subject];
    updateView({ ...view, subjects }, { push: true });
  };

  const handleRatingMinChange = (ratingMin: string) => {
    updateView({ ...view, ratingMin });
  };

  const toggleLowSample = () => {
    updateView(
      { ...view, includeLowSample: !view.includeLowSample },
      { push: true },
    );
  };

  const handlePagesMinChange = (pagesMin: string) => {
    updateView({ ...view, pagesMin });
  };

  const handlePagesMaxChange = (pagesMax: string) => {
    updateView({ ...view, pagesMax });
  };

  const toggleHold = (bucket: HoldBucket) => {
    const holds = view.holds.includes(bucket)
      ? view.holds.filter((entry) => entry !== bucket)
      : [...view.holds, bucket];
    updateView({ ...view, holds }, { push: true });
  };

  const toggleAvailableOnly = () => {
    updateView({ ...view, availableOnly: !view.availableOnly }, { push: true });
  };

  const clearFilters = () => {
    updateView(
      {
        ...view,
        author: '',
        tags: [],
        subjects: [],
        holds: [],
        availableOnly: false,
        ratingMin: '',
        includeLowSample: false,
        pagesMin: '',
        pagesMax: '',
      },
      { push: true },
    );
  };

  const setViewMode = (next: ViewMode) => {
    if (next !== view.view) updateView({ ...view, view: next }, { push: true });
  };

  const closeDetail = () => {
    dialogRef.current?.close();
    setSelected(null);
  };

  const books = catalogue?.items ?? [];
  const health = crawlerHealth(status);
  const filterCount = activeFilterCount(view);

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
                <option value="rating">Rating</option>
                <option value="holds">Holds</option>
                <option value="year">Year</option>
                <option value="pageCount">Page count</option>
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

        <section className="filters" aria-label="Filters">
          <div className="filters-header">
            <h2 className="filters-title">Filters</h2>
            {filterCount > 0 ? (
              <div className="filters-summary">
                <span>
                  {filterCount} active {filterCount === 1 ? 'filter' : 'filters'}
                </span>
                <button
                  type="button"
                  className="clear-filters"
                  onClick={clearFilters}
                >
                  Clear all
                </button>
              </div>
            ) : null}
          </div>

          <label className="filter-field">
            <span>Author</span>
            <input
              type="search"
              value={view.author}
              onChange={(event) => handleAuthorChange(event.target.value)}
              placeholder="Filter by author"
              autoComplete="off"
            />
          </label>

          <fieldset className="filter-group">
            <legend>Libib tags</legend>
            {facets && facets.tags.length > 0 ? (
              <div className="filter-options">
                {facets.tags.map((tag) => (
                  <label className="filter-option" key={tag.value}>
                    <input
                      type="checkbox"
                      checked={view.tags.includes(tag.value)}
                      onChange={() => toggleTag(tag.value)}
                    />
                    <span>{tag.value}</span>
                    <span className="filter-option-count">{tag.count}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted filter-empty">No tags yet.</p>
            )}
          </fieldset>

          <fieldset className="filter-group">
            <legend>Subjects</legend>
            {facets && facets.subjects.length > 0 ? (
              <div className="filter-options filter-options-subjects">
                {facets.subjects.map((subject) => (
                  <label className="filter-option" key={subject.value}>
                    <input
                      type="checkbox"
                      checked={view.subjects.includes(subject.value)}
                      onChange={() => toggleSubject(subject.value)}
                    />
                    <span>{subject.value}</span>
                    <span className="filter-option-count">{subject.count}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted filter-empty">No subjects yet.</p>
            )}
          </fieldset>

          <fieldset className="filter-group">
            <legend>Holds</legend>
            <div className="filter-options">
              {HOLD_BUCKETS.map((bucket) => (
                <label className="filter-option" key={bucket}>
                  <input
                    type="checkbox"
                    checked={view.holds.includes(bucket)}
                    onChange={() => toggleHold(bucket)}
                  />
                  <span>{HOLD_BUCKET_LABELS[bucket]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="filter-group">
            <legend>Minimum rating</legend>
            <div className="filter-options filter-range">
              <label className="filter-field">
                <span>Rating at least</span>
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={view.ratingMin}
                  onChange={(event) =>
                    handleRatingMinChange(event.target.value)
                  }
                  placeholder="Any"
                />
              </label>
              <label className="filter-toggle">
                <input
                  type="checkbox"
                  checked={view.includeLowSample}
                  onChange={toggleLowSample}
                />
                <span>Include low-sample ratings</span>
              </label>
            </div>
          </fieldset>

          <fieldset className="filter-group">
            <legend>Page count</legend>
            <div className="filter-options filter-range">
              <label className="filter-field">
                <span>At least</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={view.pagesMin}
                  onChange={(event) => handlePagesMinChange(event.target.value)}
                  placeholder="Any"
                />
              </label>
              <label className="filter-field">
                <span>At most</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={view.pagesMax}
                  onChange={(event) => handlePagesMaxChange(event.target.value)}
                  placeholder="Any"
                />
              </label>
            </div>
          </fieldset>

          <label className="filter-toggle">
            <input
              type="checkbox"
              checked={view.availableOnly}
              onChange={toggleAvailableOnly}
            />
            <span>Available only</span>
          </label>
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
            {view.q.trim() || filterCount > 0 ? (
              'No books match your search and filters.'
            ) : (
              <>
                No books yet. Run <code>npm run seed</code> to load fixtures.
              </>
            )}
          </p>
        ) : (
          <>
            <div className="results-toolbar">
              <p className="result-count">
                {catalogue?.total ?? 0}{' '}
                {(catalogue?.total ?? 0) === 1 ? 'book' : 'books'}
              </p>
              <div className="view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  aria-pressed={view.view === 'grid'}
                  onClick={() => setViewMode('grid')}
                >
                  Grid
                </button>
                <button
                  type="button"
                  aria-pressed={view.view === 'table'}
                  onClick={() => setViewMode('table')}
                >
                  Table
                </button>
              </div>
            </div>
            {view.view === 'table' ? (
              <BookTable books={books} onSelect={setSelected} />
            ) : (
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
            )}
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
