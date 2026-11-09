export interface Rating {
  average: number;
  count: number;
  lowSample: boolean;
}

export type EnrichmentStatus = 'enriched' | 'unmatched' | 'failed';

export interface Book {
  joinId: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  publisher: string | null;
  year: number | null;
  description: string | null;
  copies: number;
  out: number;
  holds: number;
  onShelf: number;
  available: boolean;
  tags: string[];
  subjects: string[];
  rating: Rating | null;
  pageCount: number | null;
  enrichmentStatus: EnrichmentStatus | null;
  enrichmentSource: string | null;
  refreshedAt: string | null;
  libibUrl: string;
}

export type SortField =
  | 'relevance'
  | 'title'
  | 'author'
  | 'holds'
  | 'year'
  | 'rating'
  | 'pageCount'
  | 'random';

export type SortDirection = 'asc' | 'desc';

export interface SortFieldMetadata {
  value: SortField;
  label: string;
  defaultDirection: SortDirection;
  searchOnly?: boolean;
}

export const SORT_FIELDS: readonly SortFieldMetadata[] = [
  {
    value: 'relevance',
    label: 'Relevance',
    defaultDirection: 'desc',
    searchOnly: true,
  },
  { value: 'title', label: 'Title', defaultDirection: 'asc' },
  { value: 'author', label: 'Author', defaultDirection: 'asc' },
  { value: 'rating', label: 'Rating', defaultDirection: 'asc' },
  { value: 'holds', label: 'Holds', defaultDirection: 'asc' },
  { value: 'year', label: 'Year', defaultDirection: 'asc' },
  { value: 'pageCount', label: 'Page count', defaultDirection: 'asc' },
  { value: 'random', label: 'Random', defaultDirection: 'asc' },
];

export function isSortField(value: string): value is SortField {
  return SORT_FIELDS.some((field) => field.value === value);
}

export function defaultDirectionFor(sort: SortField): SortDirection {
  return (
    SORT_FIELDS.find((field) => field.value === sort)?.defaultDirection ?? 'asc'
  );
}

export const HOLD_BUCKETS = ['0', '1-2', '3-5', '6+'] as const;

export type HoldBucket = (typeof HOLD_BUCKETS)[number];

export function isHoldBucket(value: string): value is HoldBucket {
  return (HOLD_BUCKETS as readonly string[]).includes(value);
}

export const UNMATCHED_FILTERS = ['all', 'hide', 'only'] as const;

export type UnmatchedFilter = (typeof UNMATCHED_FILTERS)[number];

export function isUnmatchedFilter(value: string): value is UnmatchedFilter {
  return (UNMATCHED_FILTERS as readonly string[]).includes(value);
}

export interface BooksQuery {
  limit?: number;
  offset?: number;
  q?: string;
  sort?: SortField;
  direction?: SortDirection;
  seed?: string;
  author?: string;
  tags?: string[];
  subjects?: string[];
  holds?: HoldBucket[];
  availableOnly?: boolean;
  ratingMin?: number;
  includeLowSample?: boolean;
  pagesMin?: number;
  pagesMax?: number;
  unmatched?: UnmatchedFilter;
}

export interface BooksResponse {
  books: Book[];
  total: number;
  nextOffset: number | null;
  meta: {
    lastIndexRefreshedAt: string | null;
  };
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface FacetsResponse {
  tags: FacetCount[];
  authors: FacetCount[];
  subjects: FacetCount[];
}

export function isUnmatchedBook(
  book: Pick<Book, 'enrichmentStatus'>,
): boolean {
  return book.enrichmentStatus !== 'enriched';
}
