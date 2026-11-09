import type {
  BooksQuery,
  BooksResponse,
  CrawlerStatus,
  FacetsResponse,
} from './types';

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
  for (const bucket of query.holds ?? []) params.append('holds', bucket);
  if (query.availableOnly) params.set('available_only', '1');

  const response = await fetch(`/api/books?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Could not load the catalogue (${response.status})`);
  }
  return (await response.json()) as BooksResponse;
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
