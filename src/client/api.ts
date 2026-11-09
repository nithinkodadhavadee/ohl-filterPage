import type { BooksQuery, BooksResponse } from './types';

export async function fetchBooks(query: BooksQuery = {}): Promise<BooksResponse> {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit ?? 200));
  params.set('offset', String(query.offset ?? 0));
  if (query.q) params.set('q', query.q);
  if (query.sort) params.set('sort', query.sort);
  if (query.direction) params.set('direction', query.direction);
  if (query.seed) params.set('seed', query.seed);

  const response = await fetch(`/api/books?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Could not load the catalogue (${response.status})`);
  }
  return (await response.json()) as BooksResponse;
}
