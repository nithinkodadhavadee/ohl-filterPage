import { describe, expect, it } from 'vitest';
import { BOOKS_BATCH_SIZE, appendCataloguePage } from '../src/client/paging.js';
import type { Book, BooksResponse } from '../src/shared/contract.js';

function book(joinId: string): Book {
  return {
    joinId,
    title: `Book ${joinId}`,
    author: null,
    coverUrl: null,
    publisher: null,
    year: null,
    description: null,
    copies: 1,
    out: 0,
    holds: 0,
    onShelf: 1,
    available: true,
    tags: [],
    subjects: [],
    rating: null,
    pageCount: null,
    enrichmentStatus: null,
    enrichmentSource: null,
    refreshedAt: null,
    libibUrl: `https://example.test/${joinId}`,
  };
}

function page(
  joinIds: string[],
  options: { total?: number; nextOffset?: number | null; refreshedAt?: string | null } = {},
): BooksResponse {
  return {
    books: joinIds.map(book),
    total: options.total ?? joinIds.length,
    nextOffset: options.nextOffset ?? null,
    meta: {
      lastIndexRefreshedAt:
        options.refreshedAt === undefined
          ? '2026-11-10T09:30:00.000Z'
          : options.refreshedAt,
    },
  };
}

describe('catalogue paging', () => {
  it('uses fixed batches of 24', () => {
    expect(BOOKS_BATCH_SIZE).toBe(24);
  });

  it('starts a catalogue from the first page', () => {
    const first = appendCataloguePage(null, page(['a', 'b'], { total: 5, nextOffset: 2 }));

    expect(first.books.map((entry) => entry.joinId)).toEqual(['a', 'b']);
    expect(first.total).toBe(5);
    expect(first.nextOffset).toBe(2);
    expect(first.meta.lastIndexRefreshedAt).toBe('2026-11-10T09:30:00.000Z');
  });

  it('appends the next page in order and updates the next offset', () => {
    const first = appendCataloguePage(null, page(['a', 'b'], { total: 4, nextOffset: 2 }));
    const second = appendCataloguePage(first, page(['c', 'd'], { total: 4 }));

    expect(second.books.map((entry) => entry.joinId)).toEqual(['a', 'b', 'c', 'd']);
    expect(second.total).toBe(4);
    expect(second.nextOffset).toBeNull();
  });

  it('does not duplicate a record when pages overlap', () => {
    const first = appendCataloguePage(null, page(['a', 'b'], { total: 5, nextOffset: 2 }));
    const second = appendCataloguePage(
      first,
      page(['b', 'c', 'd'], { total: 5, nextOffset: 4 }),
    );

    expect(second.books.map((entry) => entry.joinId)).toEqual(['a', 'b', 'c', 'd']);
    expect(second.nextOffset).toBe(4);
  });

  it('takes freshness metadata from the latest page', () => {
    const first = appendCataloguePage(null, page(['a'], { nextOffset: 1 }));
    const second = appendCataloguePage(
      first,
      page(['b'], { refreshedAt: '2026-11-10T10:00:00.000Z' }),
    );

    expect(second.meta.lastIndexRefreshedAt).toBe('2026-11-10T10:00:00.000Z');
  });
});
