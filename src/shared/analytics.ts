export const RETENTION_FOREVER = 0;

export const ANALYTICS_EVENT_KINDS = [
  'visit',
  'search',
  'filter',
  'sort',
  'book_view',
  'error',
  'outbound',
  'share',
  'filter_reset',
  'scroll',
] as const;

export type AnalyticsEventKind = (typeof ANALYTICS_EVENT_KINDS)[number];

export const BEACON_EVENT_KINDS = [
  'outbound',
  'share',
  'filter_reset',
  'scroll',
] as const;

export type BeaconEventKind = (typeof BEACON_EVENT_KINDS)[number];

export const OUTBOUND_DESTINATIONS = ['libib', 'github', 'terms'] as const;
export type OutboundDestination = (typeof OUTBOUND_DESTINATIONS)[number];

export const SHARE_OUTCOMES = ['success', 'failure'] as const;
export type ShareOutcome = (typeof SHARE_OUTCOMES)[number];

export const SCROLL_QUARTILES = [25, 50, 75, 100] as const;
export type ScrollQuartile = (typeof SCROLL_QUARTILES)[number];

export interface AnalyticsBeaconEvent {
  event: BeaconEventKind;
  destination?: OutboundDestination;
  result?: ShareOutcome;
  quartile?: ScrollQuartile;
}

export interface AnalyticsBreakdown {
  label: string;
  count: number;
}

export interface AnalyticsDay {
  day: string;
  visits: number;
  uniqueVisitors: number;
  bots: number;
}

export interface AnalyticsBookViews {
  joinId: string;
  title: string;
  views: number;
}

export interface AnalyticsSummary {
  generatedAt: string;
  approximate: true;
  pageViews: {
    total: number;
    byPath: AnalyticsBreakdown[];
  };
  daily: AnalyticsDay[];
  humans: number;
  bots: number;
  devices: AnalyticsBreakdown[];
  browsers: AnalyticsBreakdown[];
  operatingSystems: AnalyticsBreakdown[];
  referrers: AnalyticsBreakdown[];
  mostViewedBooks: AnalyticsBookViews[];
  events: AnalyticsBreakdown[];
  searches: {
    total: number;
    zeroResults: number;
  };
}
