import type { BooksResponse } from './types';

export async function fetchBooks(): Promise<BooksResponse> {
  const response = await fetch('/api/books?limit=50&offset=0');
  if (!response.ok) {
    throw new Error(`Could not load the catalogue (${response.status})`);
  }
  return (await response.json()) as BooksResponse;
}
