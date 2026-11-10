export type ViewMode = 'grid' | 'table';

export type CrawlOutcome = 'ok' | 'throttled' | 'error';

export interface CrawlerStatus {
  enabled: boolean;
  lastIndexRefreshedAt: string | null;
  cycle: {
    position: number;
    total: number;
    startedAt: string | null;
    estimatedRemainingMs: number | null;
    stalled: boolean;
  };
  lastCycle: {
    startedAt: string | null;
    finishedAt: string | null;
    duration: number | null;
    counts: Record<string, number> | null;
    lastError: string | null;
  };
  backoff: {
    attempt: number;
    active: boolean;
  };
  lastOutcome: CrawlOutcome | null;
  lastError: string | null;
}
