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

export interface BooksResponse {
  items: Book[];
  total: number;
  nextOffset: number | null;
  meta: {
    lastIndexRefreshedAt: string | null;
  };
}

export type CrawlOutcome = 'ok' | 'throttled' | 'error';

export interface CrawlerStatus {
  enabled: boolean;
  lastIndexRefreshedAt: string | null;
  cycle: {
    position: number;
    total: number;
    startedAt: string | null;
  };
  lastCycle: {
    startedAt: string | null;
    finishedAt: string | null;
  };
  backoff: {
    attempt: number;
    active: boolean;
  };
  lastOutcome: CrawlOutcome | null;
  lastError: string | null;
}
