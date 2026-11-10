import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BookDetail } from '../src/client/App.js';
import type { Book } from '../src/shared/contract.js';
import { enrichmentSourceUrl } from '../src/shared/enrichment.js';

function book(overrides: Partial<Book> = {}): Book {
  return {
    joinId: 'book-1',
    title: 'A Book',
    author: 'An Author',
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
    enrichmentSourceUrl: null,
    enrichedAt: null,
    refreshedAt: null,
    libibUrl: 'https://www.libib.com/u/openhouselibrary?solo=book-1',
    ...overrides,
  };
}

function render(detail: Book): string {
  return renderToStaticMarkup(
    createElement(BookDetail, {
      book: detail,
      permalink: 'https://example.test/?book=book-1',
    }),
  );
}

describe('enrichmentSourceUrl', () => {
  it('builds an Open Library work link from a stored work id', () => {
    expect(enrichmentSourceUrl('openlibrary', '/works/OL59863W')).toBe(
      'https://openlibrary.org/works/OL59863W',
    );
    expect(enrichmentSourceUrl('openlibrary', 'OL59863W')).toBe(
      'https://openlibrary.org/works/OL59863W',
    );
  });

  it('normalizes an Open Library URL or rejects an unknown id', () => {
    expect(
      enrichmentSourceUrl(
        'openlibrary',
        'https://openlibrary.org/works/OL59863W.json',
      ),
    ).toBe('https://openlibrary.org/works/OL59863W');
    expect(enrichmentSourceUrl('openlibrary', 'not-a-work')).toBeNull();
    expect(enrichmentSourceUrl('openlibrary', null)).toBeNull();
  });
});

describe('BookDetail enrichment source', () => {
  it('links the matched record and shows the source and enriched-at time', () => {
    const markup = render(
      book({
        enrichmentStatus: 'enriched',
        enrichmentSource: 'Open Library',
        enrichmentSourceUrl: 'https://openlibrary.org/works/OL59863W',
        enrichedAt: '2026-11-02T10:00:00.000Z',
      }),
    );

    expect(markup).toContain('Open Library');
    expect(markup).toContain(
      'href="https://openlibrary.org/works/OL59863W"',
    );
    expect(markup).toContain('Enriched');
    expect(markup).toMatch(/2026/);
  });

  it('explains an unmatched book without linking a record', () => {
    const markup = render(
      book({
        enrichmentStatus: 'unmatched',
        enrichmentSource: 'Open Library',
      }),
    );

    expect(markup).toContain(
      'No matching record was found in Open Library.',
    );
    expect(markup).not.toContain('https://openlibrary.org');
  });

  it('does not render a correction report feature', () => {
    const markup = render(
      book({
        enrichmentStatus: 'enriched',
        enrichmentSource: 'Open Library',
        enrichmentSourceUrl: 'https://openlibrary.org/works/OL59863W',
        enrichedAt: '2026-11-02T10:00:00.000Z',
      }),
    );

    expect(markup).not.toMatch(/mailto:/i);
    expect(markup).not.toMatch(/report (a |an |this )?(correction|problem|error)/i);
    expect(markup).not.toContain('<form');
  });
});
