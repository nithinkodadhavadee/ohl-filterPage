import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { fetchBook, fetchBooks, fetchFacets, fetchStatus } from './api';
import {
  HOLD_BUCKETS,
  SORT_FIELDS,
  UNMATCHED_FILTERS,
  defaultDirectionFor,
  hasNoEnrichmentData,
  type Book,
  type BooksResponse,
  type FacetsResponse,
  type HoldBucket,
  type SortField,
  type UnmatchedFilter,
} from '../shared/contract';
import { enrichmentSourceDisplayName } from '../shared/enrichment';
import {
  BADGE_COPY,
  ENRICHMENT_HINT_COPY,
  badgeExplanation,
  enrichmentHintText,
  type BadgeKind,
  type EnrichmentHintField,
} from '../shared/explanations';
import {
  FILTER_PANEL_STORAGE_KEY,
  SUBJECTS_FACET_STORAGE_KEY,
  browserSessionStorage,
  readStoredBoolean,
  subjectFacetSummary,
  writeStoredBoolean,
} from './filter-ui';
import { formatDateTime } from './format';
import { appendCataloguePage } from './paging';
import { describeSweep } from './sweep-state';
import type { CrawlerStatus, ViewMode } from './types';
import {
  activeFilterCount,
  booksQueryForView,
  createSeed,
  ensureSeed,
  parseViewState,
  viewQueryKey,
  viewToUrl,
  type ViewState,
} from './view-state';

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

type ExplanationMode =
  | { type: 'badge'; badge: BadgeKind }
  | { type: 'info' };

interface ExplanationProps {
  text: string;
  label: ReactNode;
  mode: ExplanationMode;
  ariaLabel?: string;
}

function Explanation({ text, label, mode, ariaLabel }: ExplanationProps) {
  const generatedId = useId();
  const tooltipId = `explanation-${generatedId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [open]);

  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !wrapperRef.current?.contains(next)) {
      setOpen(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') setOpen(false);
  };

  return (
    <span
      ref={wrapperRef}
      className={`explanation-wrapper explanation-wrapper-${mode.type}`}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch') setOpen(false);
      }}
    >
      <button
        type="button"
        className={
          mode.type === 'badge' ? `badge badge-${mode.badge}` : 'info-hint'
        }
        aria-describedby={tooltipId}
        aria-label={ariaLabel}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={`explanation-popover${open ? ' is-open' : ''}`}
      >
        {text}
      </span>
    </span>
  );
}

function Badge({ book, kind }: { book: Book; kind: BadgeKind }) {
  return (
    <Explanation
      label={BADGE_COPY[kind]}
      text={badgeExplanation(kind, {
        status: book.enrichmentStatus,
        source: book.enrichmentSource,
      })}
      mode={{ type: 'badge', badge: kind }}
    />
  );
}

function BookBadges({ book }: { book: Book }) {
  const kinds: BadgeKind[] = [
    book.available ? 'available' : 'unavailable',
  ];
  if (book.rating?.lowSample) kinds.push('low-sample');
  if (hasNoEnrichmentData(book.enrichmentStatus)) kinds.push('unmatched');

  return (
    <>
      {kinds.map((kind) => (
        <Badge key={kind} book={book} kind={kind} />
      ))}
    </>
  );
}

function EnrichmentHint({
  field,
  source,
}: {
  field: EnrichmentHintField;
  source: string | null;
}) {
  const label = ENRICHMENT_HINT_COPY[field];

  return (
    <Explanation
      text={enrichmentHintText(field, source)}
      label="i"
      ariaLabel={`About ${label}`}
      mode={{ type: 'info' }}
    />
  );
}

function BookEnrichment({ book }: { book: Book }) {
  const sourceName = enrichmentSourceDisplayName(book.enrichmentSource);
  const enriched = book.enrichmentStatus === 'enriched';

  return (
    <section className="detail-section" aria-labelledby="detail-enrichment">
      <h3 id="detail-enrichment">Enrichment</h3>
      {enriched ? (
        <>
          <dl className="enrichment-grid">
            <div>
              <dt>Source</dt>
              <dd>{sourceName}</dd>
            </div>
            <div>
              <dt>Enriched</dt>
              <dd>{formatDateTime(book.enrichedAt, 'unknown')}</dd>
            </div>
          </dl>
          {book.enrichmentSourceUrl ? (
            <p>
              <a
                className="detail-link"
                href={book.enrichmentSourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                View matched record on {sourceName}
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted">
          {book.enrichmentStatus === 'unmatched'
            ? book.enrichmentSource
              ? `No matching record was found in ${sourceName}.`
              : 'No matching record was found.'
            : book.enrichmentStatus === 'failed'
              ? book.enrichmentSource
                ? `Enrichment from ${sourceName} has not completed.`
                : 'Enrichment has not completed.'
              : 'This book has not been enriched yet.'}
        </p>
      )}
    </section>
  );
}

function RatingBadge({
  book,
  precision = 2,
  emptyLabel = '—',
  className,
  showMax = false,
  showCountLabel = false,
}: {
  book: Book;
  precision?: number;
  emptyLabel?: string | null;
  className?: string;
  showMax?: boolean;
  showCountLabel?: boolean;
}) {
  if (book.rating) {
    const count = book.rating.count;
    return (
      <span className={className ?? 'rating-cell'}>
        {showMax ? null : <span aria-hidden="true">★</span>}{' '}
        {book.rating.average.toFixed(precision)}
        {showMax ? ' / 5' : null}
        <span className="muted">
          {' '}
          ({count}
          {showCountLabel ? ` ${count === 1 ? 'rating' : 'ratings'}` : ''})
        </span>
      </span>
    );
  }

  if (emptyLabel === null) return null;
  return <span className={className ?? 'muted'}>{emptyLabel}</span>;
}

export function BookDetail({
  book,
  permalink,
}: {
  book: Book;
  permalink: string;
}) {
  const [copied, setCopied] = useState(false);
  const sweep = describeSweep(book.sweep);

  const copyLink = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(permalink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="detail-layout">
      <div className="detail-cover">
        <Cover book={book} />
      </div>
      <div className="detail-main">
        <h2 id="detail-title">{book.title}</h2>
        <p className="detail-author">{book.author || 'Author unknown'}</p>

        <div className="detail-badges">
          <BookBadges book={book} />
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
          {sweep.hasSuccessfulSweep ? (
            <p className="muted detail-sweep">
              Last successful sweep {formatDateTime(sweep.lastSuccessAt, 'unknown')}.
            </p>
          ) : null}
        </section>

        <section className="detail-section" aria-labelledby="detail-publication">
          <h3 id="detail-publication">Publication</h3>
          <p>
            {book.publisher ?? 'Publisher unknown'}
            <span aria-hidden="true"> · </span>
            {book.year ?? 'Year unknown'}
          </p>
        </section>

        <section
          className="detail-section"
          aria-labelledby="detail-page-count"
        >
          <div className="detail-heading-row">
            <h3 id="detail-page-count">Page count</h3>
            {book.enrichmentSource ? (
              <EnrichmentHint field="pageCount" source={book.enrichmentSource} />
            ) : null}
          </div>
          <p>
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
          <div className="detail-heading-row">
            <h3 id="detail-rating">Rating</h3>
            {book.enrichmentSource ? (
              <EnrichmentHint field="rating" source={book.enrichmentSource} />
            ) : null}
          </div>
          <p>
            <RatingBadge
              book={book}
              precision={2}
              emptyLabel="No rating yet."
              showMax
              showCountLabel
            />
          </p>
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
          <div className="detail-heading-row">
            <h3 id="detail-subjects">Subjects</h3>
            {book.enrichmentSource ? (
              <EnrichmentHint field="subjects" source={book.enrichmentSource} />
            ) : null}
          </div>
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

        <BookEnrichment book={book} />

        <footer className="detail-footer">
          <p className="muted">
            This record refreshed {formatDateTime(book.refreshedAt, 'unknown')}
          </p>
          <div className="detail-actions">
            <button type="button" className="copy-link" onClick={copyLink}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            <a
              className="libib-link"
              href={book.libibUrl}
              target="_blank"
              rel="noreferrer"
            >
              View on Libib
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

const HOLD_BUCKET_LABELS: Record<HoldBucket, string> = {
  '0': 'None (0)',
  '1-2': '1–2',
  '3-5': '3–5',
  '6+': '6 or more',
};

const UNMATCHED_FILTER_OPTIONS: Record<UnmatchedFilter, string> = {
  all: 'All books',
  hide: 'Hide unmatched',
  only: 'Only unmatched',
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
          <th scope="col">Swept</th>
        </tr>
      </thead>
      <tbody>
        {books.map((book) => {
          const sweep = describeSweep(book.sweep);
          return (
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
                <span className="badge-group">
                  <RatingBadge book={book} precision={2} emptyLabel="—" />
                  {book.rating?.lowSample ? (
                    <Badge book={book} kind="low-sample" />
                  ) : null}
                </span>
              </td>
              <td data-label="Holds">{book.holds}</td>
              <td data-label="Availability">
                <span className="badge-group">
                  <Badge
                    book={book}
                    kind={book.available ? 'available' : 'unavailable'}
                  />
                  {hasNoEnrichmentData(book.enrichmentStatus) ? (
                    <Badge book={book} kind="unmatched" />
                  ) : null}
                </span>
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
              <td data-label="Swept">
                {sweep.hasSuccessfulSweep ? (
                  formatDateTime(sweep.lastSuccessAt)
                ) : (
                  <span className="muted">Not yet swept</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AuthorMultiSelect({
  authors,
  selected,
  onToggle,
  onClear,
}: {
  authors: FacetsResponse['authors'];
  selected: string[];
  onToggle: (author: string) => void;
  onClear: () => void;
}) {
  const [search, setSearch] = useState('');
  const trimmedSearch = search.trim().toLowerCase();
  const options = trimmedSearch
    ? authors.filter((author) =>
        author.value.toLowerCase().includes(trimmedSearch),
      )
    : authors;

  return (
    <fieldset className="filter-group author-filter">
      <legend>Authors</legend>
      {selected.length > 0 ? (
        <div className="author-selection">
          <ul className="chip-list author-chips" aria-label="Selected authors">
            {selected.map((author) => (
              <li key={author}>
                <button
                  type="button"
                  className="chip author-chip"
                  onClick={() => onToggle(author)}
                  aria-label={`Remove ${author}`}
                >
                  <span>{author}</span>
                  <span aria-hidden="true"> ×</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="clear-group" onClick={onClear}>
            Clear
          </button>
        </div>
      ) : null}
      <label className="filter-field">
        <span className="visually-hidden">Search authors</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search authors"
          autoComplete="off"
        />
      </label>
      <div
        className="filter-options filter-options-authors"
        role="group"
        aria-label="Author options"
      >
        {options.length > 0 ? (
          options.map((author) => {
            const checked = selected.some(
              (name) => name.toLowerCase() === author.value.toLowerCase(),
            );
            return (
              <label className="filter-option" key={author.value}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(author.value)}
                />
                <span>{author.value}</span>
                <span className="filter-option-count">{author.count}</span>
              </label>
            );
          })
        ) : (
          <p className="muted filter-empty">
            No authors match {search.trim() ? `“${search.trim()}”` : 'yet'}.
          </p>
        )}
      </div>
    </fieldset>
  );
}

function bookPermalink(view: ViewState, joinId: string): string {
  const url = new URL(viewToUrl(view), window.location.href);
  url.searchParams.set('book', joinId);
  return url.toString();
}

function readBookParam(search: string): string | null {
  const value = new URLSearchParams(search).get('book')?.trim();
  return value ? value : null;
}

function useStoredToggle(
  key: string,
  fallback: boolean,
): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() =>
    readStoredBoolean(browserSessionStorage(), key, fallback),
  );

  const toggle = useCallback(() => {
    setValue((current) => {
      const next = !current;
      writeStoredBoolean(browserSessionStorage(), key, next);
      return next;
    });
  }, [key]);

  return [value, toggle];
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Book | null>(null);
  const [filtersOpen, toggleFilters] = useStoredToggle(
    FILTER_PANEL_STORAGE_KEY,
    true,
  );
  const [subjectsOpen, toggleSubjects] = useStoredToggle(
    SUBJECTS_FACET_STORAGE_KEY,
    false,
  );
  const [reloadToken, setReloadToken] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const nextOffsetRef = useRef<number | null>(null);
  const nextOffsetQueryKeyRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  const requestVersionRef = useRef(0);
  const queryKey = viewQueryKey(view);

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
    const joinId = readBookParam(window.location.search);
    if (!joinId) return;
    let cancelled = false;
    fetchBook(joinId)
      .then((book) => {
        if (!cancelled) setSelected(book);
      })
      .catch(() => {
        // A stale book link should not stop the catalogue from rendering.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

      const joinId = readBookParam(window.location.search);
      if (joinId) {
        fetchBook(joinId)
          .then((book) => setSelected(book))
          .catch(() => setSelected(null));
      } else {
        setSelected(null);
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const version = requestVersionRef.current + 1;
    requestVersionRef.current = version;
    nextOffsetRef.current = null;
    nextOffsetQueryKeyRef.current = null;
    loadingMoreRef.current = false;
    setLoading(true);
    setLoadingMore(false);
    setLoadMoreError(null);
    setError(null);

    fetchBooks(booksQueryForView(view, 0))
      .then((data) => {
        if (cancelled || requestVersionRef.current !== version) return;
        nextOffsetRef.current = data.nextOffset;
        nextOffsetQueryKeyRef.current = queryKey;
        setCatalogue(data);
      })
      .catch((caught) => {
        if (cancelled || requestVersionRef.current !== version) return;
        setError(
          caught instanceof Error
            ? caught.message
            : 'Could not load the catalogue',
        );
      })
      .finally(() => {
        if (cancelled || requestVersionRef.current !== version) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [queryKey, reloadToken]);

  const loadMore = useCallback(() => {
    if (loading || loadingMoreRef.current) return;
    if (nextOffsetQueryKeyRef.current !== queryKey) return;
    const offset = nextOffsetRef.current;
    if (offset === null) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const version = requestVersionRef.current;

    fetchBooks(booksQueryForView(view, offset))
      .then((page) => {
        if (requestVersionRef.current !== version) return;
        nextOffsetRef.current = page.nextOffset;
        setCatalogue((current) => appendCataloguePage(current, page));
      })
      .catch((caught) => {
        if (requestVersionRef.current !== version) return;
        setLoadMoreError(
          caught instanceof Error
            ? caught.message
            : 'Could not load more books',
        );
      })
      .finally(() => {
        if (requestVersionRef.current !== version) return;
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [loading, queryKey, view]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selected) {
      if (!dialog.open) dialog.showModal();
      const resetScroll = () => {
        dialog.scrollTop = 0;
      };
      resetScroll();
      const frame = window.requestAnimationFrame(resetScroll);
      return () => window.cancelAnimationFrame(frame);
    }
    if (dialog.open) dialog.close();
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
      direction = defaultDirectionFor(sort);
    } else if (view.sort === 'relevance') {
      direction = defaultDirectionFor(sort);
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

  const toggleAuthor = (author: string) => {
    const exists = view.authors.some(
      (entry) => entry.toLowerCase() === author.toLowerCase(),
    );
    const authors = exists
      ? view.authors.filter(
          (entry) => entry.toLowerCase() !== author.toLowerCase(),
        )
      : [...view.authors, author];
    updateView({ ...view, authors }, { push: true });
  };

  const clearAuthors = () => {
    if (view.authors.length === 0) return;
    updateView({ ...view, authors: [] }, { push: true });
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

  const handleUnmatchedChange = (unmatched: UnmatchedFilter) => {
    updateView({ ...view, unmatched }, { push: true });
  };

  const clearFilterGroup = (isEmpty: boolean, next: Partial<ViewState>) => {
    if (isEmpty) return;
    updateView({ ...view, ...next }, { push: true });
  };

  const clearRating = () =>
    clearFilterGroup(!view.ratingMin.trim(), { ratingMin: '' });

  const clearPages = () =>
    clearFilterGroup(!view.pagesMin.trim() && !view.pagesMax.trim(), {
      pagesMin: '',
      pagesMax: '',
    });

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
        authors: [],
        tags: [],
        subjects: [],
        holds: [],
        availableOnly: false,
        ratingMin: '',
        includeLowSample: false,
        pagesMin: '',
        pagesMax: '',
        unmatched: 'all',
      },
      { push: true },
    );
  };

  const setViewMode = (next: ViewMode) => {
    if (next !== view.view) updateView({ ...view, view: next }, { push: true });
  };

  const closeDetail = () => {
    dialogRef.current?.close();
    const url = new URL(window.location.href);
    if (url.searchParams.has('book')) {
      url.searchParams.delete('book');
      window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    }
    setSelected(null);
  };

  const books = catalogue?.books ?? [];
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
              {formatDateTime(
                catalogue?.meta.lastIndexRefreshedAt ?? null,
                'unknown',
              )}
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
                {SORT_FIELDS.filter(
                  (field) => !field.searchOnly || view.q.trim(),
                ).map((field) => (
                  <option key={field.value} value={field.value}>
                    {field.label}
                  </option>
                ))}
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
            <h2 className="filters-title">
              <button
                type="button"
                className="filters-toggle"
                aria-expanded={filtersOpen}
                aria-controls="filters-body"
                onClick={toggleFilters}
              >
                <span
                  className={`filters-chevron${filtersOpen ? ' is-open' : ''}`}
                  aria-hidden="true"
                >
                  ▸
                </span>
                Filters
              </button>
            </h2>
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

          <div className="filters-body" id="filters-body" hidden={!filtersOpen}>
            <AuthorMultiSelect
              authors={facets?.authors ?? []}
              selected={view.authors}
              onToggle={toggleAuthor}
              onClear={clearAuthors}
            />

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
              <button
                type="button"
                className="facet-toggle"
                aria-expanded={subjectsOpen}
                aria-controls="subject-options"
                onClick={toggleSubjects}
              >
                <span className="visually-hidden">Subjects: </span>
                <span>{subjectFacetSummary(view.subjects)}</span>
                <span className="facet-toggle-action" aria-hidden="true">
                  {subjectsOpen ? 'Hide' : 'Show'}
                </span>
              </button>
              <div
                className="filter-options filter-options-subjects"
                id="subject-options"
                hidden={!subjectsOpen}
              >
                {facets && facets.subjects.length > 0 ? (
                  facets.subjects.map((subject) => (
                    <label className="filter-option" key={subject.value}>
                      <input
                        type="checkbox"
                        checked={view.subjects.includes(subject.value)}
                        onChange={() => toggleSubject(subject.value)}
                      />
                      <span>{subject.value}</span>
                      <span className="filter-option-count">{subject.count}</span>
                    </label>
                  ))
                ) : (
                  <p className="muted filter-empty">No subjects yet.</p>
                )}
              </div>
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
                <button
                  type="button"
                  className="clear-group"
                  onClick={clearRating}
                  disabled={!view.ratingMin.trim()}
                  aria-label="Clear rating minimum"
                >
                  Clear
                </button>
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
                    onChange={(event) =>
                      handlePagesMinChange(event.target.value)
                    }
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
                    onChange={(event) =>
                      handlePagesMaxChange(event.target.value)
                    }
                    placeholder="Any"
                  />
                </label>
                <button
                  type="button"
                  className="clear-group"
                  onClick={clearPages}
                  disabled={!view.pagesMin.trim() && !view.pagesMax.trim()}
                  aria-label="Clear page count bounds"
                >
                  Clear
                </button>
              </div>
            </fieldset>

            <fieldset className="filter-group">
              <legend>Unmatched enrichment</legend>
              <div className="filter-options">
                {UNMATCHED_FILTERS.map((value) => (
                  <label className="filter-option" key={value}>
                    <input
                      type="radio"
                      name="unmatched-filter"
                      value={value}
                      checked={view.unmatched === value}
                      onChange={() => handleUnmatchedChange(value)}
                    />
                    <span>{UNMATCHED_FILTER_OPTIONS[value]}</span>
                  </label>
                ))}
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
                    <div className="book-card">
                      <button
                        type="button"
                        className="book-card-open"
                        onClick={() => setSelected(book)}
                        aria-label={`${book.title}${book.author ? ` by ${book.author}` : ''}`}
                      />
                      <div className="book-card-body">
                        <Cover book={book} />
                        <span className="book-card-title">{book.title}</span>
                        <span className="book-card-author">
                          {book.author || 'Author unknown'}
                        </span>
                        <span className="book-card-meta">
                          <span className="book-card-badges">
                            <BookBadges book={book} />
                          </span>
                          <span className="book-card-holds">
                            Holds: {book.holds}
                          </span>
                        </span>
                        <RatingBadge
                          book={book}
                          precision={1}
                          className="book-card-rating"
                          emptyLabel={null}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={sentinelRef} className="scroll-sentinel" aria-hidden="true" />
            {loadMoreError ? (
              <div className="status status-error" role="alert">
                <p>{loadMoreError}</p>
                <button type="button" onClick={loadMore}>
                  Try again
                </button>
              </div>
            ) : loadingMore ? (
              <p className="status" role="status">
                Loading more books…
              </p>
            ) : null}
          </>
        )}
      </main>

      <footer className="site-footer">
        <p className="muted">Open House Library catalogue</p>
        <a href="/status">System status</a>
      </footer>

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
            <BookDetail
              book={selected}
              permalink={bookPermalink(view, selected.joinId)}
            />
          </>
        ) : null}
      </dialog>
    </div>
  );
}
