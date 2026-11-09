export interface Rating {
  average: number;
  count: number;
  lowSample: boolean;
}

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
  refreshedAt: string | null;
  libibUrl: string;
}

export type SortField =
  | 'relevance'
  | 'title'
  | 'author'
  | 'holds'
  | 'year'
  | 'random';

export type SortDirection = 'asc' | 'desc';

export interface BooksQuery {
  q?: string;
  sort?: SortField;
  direction?: SortDirection;
  seed?: string;
  limit?: number;
  offset?: number;
}

export interface BooksResponse {
  items: Book[];
  total: number;
  nextOffset: number | null;
  meta: {
    lastIndexRefreshedAt: string | null;
  };
}
