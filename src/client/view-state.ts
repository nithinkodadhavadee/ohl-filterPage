import {
  defaultDirectionFor,
  isHoldBucket,
  isSortField,
  normalizeUnmatchedFilter,
  type BooksQuery,
  type HoldBucket,
  type SortDirection,
  type SortField,
  type UnmatchedFilter,
} from '../shared/contract';
import { uniqueCaseInsensitive } from '../shared/authors';
import { parseOptionalNumber } from './filter-ui';
import { BOOKS_BATCH_SIZE } from './paging';
import type { ViewMode } from './types';

export interface ViewState {
  q: string;
  sort: SortField;
  direction: SortDirection;
  seed: string | null;
  authors: string[];
  tags: string[];
  subjects: string[];
  holds: HoldBucket[];
  availableOnly: boolean;
  ratingMin: string;
  includeLowSample: boolean;
  pagesMin: string;
  pagesMax: string;
  unmatched: UnmatchedFilter;
  view: ViewMode;
}

export function createSeed(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function parseViewState(search: string): ViewState {
  const params = new URLSearchParams(search);
  const q = (params.get('q') ?? '').trim();
  const rawSort = params.get('sort');
  let sort: SortField = q ? 'relevance' : 'title';

  if (rawSort && isSortField(rawSort)) {
    sort = rawSort;
  }
  if (!q && sort === 'relevance') sort = 'title';

  const rawDirection = params.get('direction');
  const direction: SortDirection =
    rawDirection === 'asc' || rawDirection === 'desc'
      ? rawDirection
      : defaultDirectionFor(sort);

  const authors = uniqueCaseInsensitive(params.getAll('author'));
  const tags = [...new Set(params.getAll('tag').filter(Boolean))];
  const subjects = [...new Set(params.getAll('subject').filter(Boolean))];
  const holds = [
    ...new Set(
      params
        .getAll('holds')
        .filter((value): value is HoldBucket => isHoldBucket(value)),
    ),
  ];
  const unmatched = normalizeUnmatchedFilter(params.get('unmatched'));

  return {
    q,
    sort,
    direction,
    seed: params.get('seed'),
    authors,
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
    unmatched,
    view: params.get('view') === 'table' ? 'table' : 'grid',
  };
}

export function activeFilterCount(view: ViewState): number {
  return (
    view.authors.length +
    view.tags.length +
    view.subjects.length +
    view.holds.length +
    (view.availableOnly ? 1 : 0) +
    (view.ratingMin.trim() ? 1 : 0) +
    (view.includeLowSample ? 1 : 0) +
    (view.pagesMin.trim() ? 1 : 0) +
    (view.pagesMax.trim() ? 1 : 0) +
    (view.unmatched !== 'all' ? 1 : 0)
  );
}

export function ensureSeed(view: ViewState): ViewState {
  if (view.sort === 'random' && !view.seed) {
    return { ...view, seed: createSeed() };
  }
  return view;
}

export function viewToUrl(
  view: ViewState,
  pathname = typeof window === 'undefined' ? '' : window.location.pathname,
): string {
  const params = new URLSearchParams();
  if (view.q) params.set('q', view.q);
  params.set('sort', view.sort);
  params.set('direction', view.direction);
  if (view.sort === 'random' && view.seed) params.set('seed', view.seed);
  for (const author of view.authors) params.append('author', author);
  for (const tag of view.tags) params.append('tag', tag);
  for (const subject of view.subjects) params.append('subject', subject);
  for (const bucket of view.holds) params.append('holds', bucket);
  if (view.availableOnly) params.set('available', '1');
  if (view.ratingMin.trim()) params.set('rating_min', view.ratingMin.trim());
  if (view.includeLowSample) params.set('include_low_sample', '1');
  if (view.pagesMin.trim()) params.set('pages_min', view.pagesMin.trim());
  if (view.pagesMax.trim()) params.set('pages_max', view.pagesMax.trim());
  if (view.unmatched !== 'all') params.set('unmatched', view.unmatched);
  if (view.view === 'table') params.set('view', 'table');
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function filterQueryForView(
  view: ViewState,
): Omit<BooksQuery, 'limit' | 'offset'> {
  return {
    q: view.q || undefined,
    sort: view.sort,
    direction: view.direction,
    seed: view.sort === 'random' ? view.seed ?? undefined : undefined,
    authors: view.authors,
    tags: view.tags,
    subjects: view.subjects,
    holds: view.holds,
    availableOnly: view.availableOnly,
    ratingMin: parseOptionalNumber(view.ratingMin),
    includeLowSample: view.includeLowSample,
    pagesMin: parseOptionalNumber(view.pagesMin),
    pagesMax: parseOptionalNumber(view.pagesMax),
    unmatched: view.unmatched,
  };
}

export function viewQueryKey(view: ViewState): string {
  return JSON.stringify(filterQueryForView(view));
}

export function booksQueryForView(view: ViewState, offset: number): BooksQuery {
  return {
    ...filterQueryForView(view),
    limit: BOOKS_BATCH_SIZE,
    offset,
  };
}
