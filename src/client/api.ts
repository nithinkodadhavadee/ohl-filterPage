import type {
  Book,
  BooksQuery,
  BooksResponse,
  FacetsResponse,
} from '../shared/contract';
import type { CrawlerStatus } from './types';

export async function fetchBooks(query: BooksQuery = {}): Promise<BooksResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit ?? 200));
  params.set('offset', String(query.offset ?? 0));
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  if (query.direction) params.set('direction', query.direction);
  if (query.seed) params.set('seed', query.seed);
  if (query.author) params.set('author', query.author);
  for (const tag of query.tags ?? []) params.append('tag', tag);
  for (const subject of query.subjects ?? []) params.append('subject', subject);
  for (const bucket of query.holds ?? []) params.append('holds', bucket);
  if (query.availableOnly) params.set('available_only', '1');
  if (query.ratingMin !== undefined) {
    params.set('rating_min', String(query.ratingMin));
  }
  if (query.includeLowSample) params.set('include_low_sample', '1');
  if (query.pagesMin !== undefined) params.set('pages_min', String(query.pagesMin));
  if (query.pagesMax !== undefined) params.set('pages_max', String(query.pagesMax));
  if (query.unmatched && query.unmatched !== 'all') {
    params.set('unmatched', query.unmatched);
  }

  const response = await fetch(`/api/books?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Could not load the catalogue (${response.status})`);
  }
  return (await response.json()) as BooksResponse;
}

export async function fetchBook(joinId: string): Promise<Book> {
  const response = await fetch(`/api/books/${encodeURIComponent(joinId)}`);
  if (!response.ok) {
    throw new Error(`Could not load the book (${response.status})`);
  }
  return (await response.json()) as Book;
}

export async function fetchFacets(): Promise<FacetsResponse> {
  const response = await fetch('/api/facets');
  if (!response.ok) {
    throw new Error(`Could not load filters (${response.status})`);
  }
  return (await response.json()) as FacetsResponse;
}

export async function fetchStatus(): Promise<CrawlerStatus> {
  const response = await fetch('/api/status');
  if (!response.ok) {
    throw new Error(`Could not load crawler status (${response.status})`);
  }
  return (await response.json()) as CrawlerStatus;
}
