import type { Book, BooksResponse } from '../shared/contract';

export const BOOKS_BATCH_SIZE = 24;

function uniqueBooks(existing: Book[], incoming: Book[]): Book[] {
  const seen = new Set(existing.map((book) => book.joinId));
  const merged = [...existing];

  for (const book of incoming) {
    if (seen.has(book.joinId)) continue;
    seen.add(book.joinId);
    merged.push(book);
  }

  return merged;
}

export function appendCataloguePage(
  current: BooksResponse | null,
  page: BooksResponse,
): BooksResponse {
  return {
    books: uniqueBooks(current?.books ?? [], page.books),
    total: page.total,
    nextOffset: page.nextOffset,
    meta: page.meta,
  };
}
