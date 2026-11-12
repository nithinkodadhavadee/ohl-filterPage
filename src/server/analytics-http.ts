import type { FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import {
  defaultDirectionFor,
  isHoldBucket,
} from '../shared/contract.js';
import {
  OUTBOUND_DESTINATIONS,
  SCROLL_QUARTILES,
  SHARE_OUTCOMES,
  type AnalyticsBeaconEvent,
} from '../shared/analytics.js';
import {
  parseUserAgent,
  recordAnalyticsEvent,
  visitorHashFor,
  type UserAgentInfo,
} from './analytics.js';
import { stripQuery } from './logging.js';
import {
  parseBoolean,
  parseDirection,
  parseNumber,
  parseSort,
  parseUnmatched,
  toArray,
  type BooksQueryParams,
} from './query-params.js';

const DEFAULT_SORT_SIGNATURE = `title:${defaultDirectionFor('title')}`;
const BEACON_KEYS = new Set(['event', 'destination', 'result', 'quartile']);
const BEACON_WINDOW_MS = 60_000;
const BEACON_MAX_EVENTS = 30;
const MAX_TRACKED_CLIENTS = 5000;
const ASSET_PATH =
  /\.(?:js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|json|txt|xml)$/i;

export type AnalyticsBeaconResult = 'accepted' | 'invalid' | 'rate-limited';

interface AnalyticsRequestContext {
  occurredAt: Date;
  visitorHash: string;
  info: UserAgentInfo;
}

export interface AnalyticsCaptureOptions {
  db: DatabaseSync;
  now: () => Date;
  settleMs: number;
}

export interface AnalyticsCapture {
  captureVisit(request: FastifyRequest): void;
  captureError(request: FastifyRequest, statusCode: number): void;
  captureBookView(request: FastifyRequest, joinId: string): void;
  captureCatalogueQuery(
    request: FastifyRequest,
    query: BooksQueryParams,
    total: number,
  ): void;
  captureBeacon(request: FastifyRequest, body: unknown): AnalyticsBeaconResult;
  flush(): void;
}

function headerString(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export function requestPath(request: FastifyRequest): string {
  const url = request.raw.url ?? request.url ?? '/';
  return stripQuery(url) || '/';
}

function isAssetPath(pathname: string): boolean {
  return (
    pathname.startsWith('/covers/') ||
    pathname.startsWith('/assets/') ||
    ASSET_PATH.test(pathname)
  );
}

function referrerHost(request: FastifyRequest): string | null {
  const referer = headerString(request.headers.referer);
  if (!referer) return null;
  try {
    return new URL(referer).hostname || null;
  } catch {
    return null;
  }
}

function filterDescriptor(
  query: BooksQueryParams,
): Record<string, unknown> | null {
  const descriptor: Record<string, unknown> = {};

  const authors = toArray(query.author).filter(Boolean);
  if (authors.length > 0) descriptor.authors = authors;
  const tags = toArray(query.tag).filter(Boolean);
  if (tags.length > 0) descriptor.tags = tags;
  const subjects = toArray(query.subject).filter(Boolean);
  if (subjects.length > 0) descriptor.subjects = subjects;
  const holds = toArray(query.holds).filter(isHoldBucket);
  if (holds.length > 0) descriptor.holds = holds;
  if (parseBoolean(query.available_only)) descriptor.availableOnly = true;
  const ratingMin = parseNumber(query.rating_min, 0, 5);
  if (ratingMin !== undefined) descriptor.ratingMin = ratingMin;
  if (query.include_low_sample !== undefined) {
    descriptor.includeLowSample = parseBoolean(query.include_low_sample);
  }
  const pagesMin = parseNumber(query.pages_min, 0, Number.MAX_SAFE_INTEGER);
  if (pagesMin !== undefined) descriptor.pagesMin = pagesMin;
  const pagesMax = parseNumber(query.pages_max, 0, Number.MAX_SAFE_INTEGER);
  if (pagesMax !== undefined) descriptor.pagesMax = pagesMax;
  const unmatched = parseUnmatched(query.unmatched);
  if (unmatched !== 'all') descriptor.unmatched = unmatched;

  return Object.keys(descriptor).length > 0 ? descriptor : null;
}

function sortSignatureFor(query: BooksQueryParams): string {
  const sort = parseSort(query.sort) ?? 'title';
  const direction =
    parseDirection(query.direction) ?? defaultDirectionFor(sort);
  return `${sort}:${direction}`;
}

function parseBeaconBody(body: unknown): AnalyticsBeaconEvent | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !BEACON_KEYS.has(key))) return null;

  switch (record.event) {
    case 'outbound':
      if (
        typeof record.destination !== 'string' ||
        !(OUTBOUND_DESTINATIONS as readonly string[]).includes(
          record.destination,
        ) ||
        record.result !== undefined ||
        record.quartile !== undefined
      ) {
        return null;
      }
      return {
        event: 'outbound',
        destination: record.destination as AnalyticsBeaconEvent['destination'],
      };
    case 'share':
      if (
        typeof record.result !== 'string' ||
        !(SHARE_OUTCOMES as readonly string[]).includes(record.result) ||
        record.destination !== undefined ||
        record.quartile !== undefined
      ) {
        return null;
      }
      return {
        event: 'share',
        result: record.result as AnalyticsBeaconEvent['result'],
      };
    case 'scroll':
      if (
        typeof record.quartile !== 'number' ||
        !(SCROLL_QUARTILES as readonly number[]).includes(record.quartile) ||
        record.destination !== undefined ||
        record.result !== undefined
      ) {
        return null;
      }
      return {
        event: 'scroll',
        quartile: record.quartile as AnalyticsBeaconEvent['quartile'],
      };
    case 'filter_reset':
      if (
        record.destination !== undefined ||
        record.result !== undefined ||
        record.quartile !== undefined
      ) {
        return null;
      }
      return { event: 'filter_reset' };
    default:
      return null;
  }
}

function beaconDetail(event: AnalyticsBeaconEvent): string {
  switch (event.event) {
    case 'outbound':
      return event.destination ?? '';
    case 'share':
      return event.result ?? '';
    case 'scroll':
      return String(event.quartile ?? '');
    case 'filter_reset':
      return 'reset';
  }
}

export function createAnalyticsCapture(
  options: AnalyticsCaptureOptions,
): AnalyticsCapture {
  const { db, now, settleMs } = options;
  const pendingSearches = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; write: () => void }
  >();
  const lastFilters = new Map<string, string>();
  const lastSorts = new Map<string, string>();
  const beaconBuckets = new Map<string, number[]>();

  const rememberClient = <T>(map: Map<string, T>, key: string, value: T) => {
    if (map.size > MAX_TRACKED_CLIENTS && !map.has(key)) map.clear();
    map.set(key, value);
  };

  const context = (request: FastifyRequest): AnalyticsRequestContext => {
    const userAgent = headerString(request.headers['user-agent']);
    const occurredAt = now();
    return {
      occurredAt,
      info: parseUserAgent(userAgent),
      visitorHash: visitorHashFor(db, request.ip, userAgent, occurredAt),
    };
  };

  const identity = (ctx: AnalyticsRequestContext) => ({
    occurredAt: ctx.occurredAt,
    visitorHash: ctx.visitorHash,
    isBot: ctx.info.bot,
    device: ctx.info.device,
    browser: ctx.info.browser,
    os: ctx.info.os,
  });

  const scheduleSearch = (key: string, write: () => void): void => {
    const pending = pendingSearches.get(key);
    if (pending) clearTimeout(pending.timer);
    if (settleMs <= 0) {
      pendingSearches.delete(key);
      write();
      return;
    }
    const timer = setTimeout(() => {
      pendingSearches.delete(key);
      write();
    }, settleMs);
    timer.unref?.();
    pendingSearches.set(key, { timer, write });
  };

  const beaconAllowed = (key: string): boolean => {
    const timestamp = now().getTime();
    const recent = (beaconBuckets.get(key) ?? []).filter(
      (entry) => timestamp - entry < BEACON_WINDOW_MS,
    );
    if (recent.length >= BEACON_MAX_EVENTS) {
      rememberClient(beaconBuckets, key, recent);
      return false;
    }
    recent.push(timestamp);
    rememberClient(beaconBuckets, key, recent);
    return true;
  };

  return {
    captureVisit(request) {
      const pathname = requestPath(request);
      const path = pathname === '/status/' ? '/status' : pathname;
      if (path !== '/' && path !== '/status') return;
      const ctx = context(request);
      recordAnalyticsEvent(db, {
        kind: 'visit',
        ...identity(ctx),
        referrerHost: referrerHost(request),
        path,
      });
    },

    captureError(request, statusCode) {
      if (statusCode < 400) return;
      const pathname = requestPath(request);
      if (pathname.startsWith('/api/analytics')) return;
      if (isAssetPath(pathname)) return;
      if (!pathname.startsWith('/api/') && statusCode !== 404) return;

      const ctx = context(request);
      recordAnalyticsEvent(db, {
        kind: 'error',
        ...identity(ctx),
        path: pathname,
        statusCode,
      });
    },

    captureBookView(request, joinId) {
      const ctx = context(request);
      recordAnalyticsEvent(db, {
        kind: 'book_view',
        ...identity(ctx),
        path: requestPath(request),
        detail: joinId,
      });
    },

    captureCatalogueQuery(request, query, total) {
      const ctx = context(request);
      const descriptor = filterDescriptor(query);
      const filterSignature = descriptor ? JSON.stringify(descriptor) : '';
      const previousFilters = lastFilters.get(ctx.visitorHash);
      if (filterSignature && filterSignature !== previousFilters) {
        recordAnalyticsEvent(db, {
          kind: 'filter',
          occurredAt: ctx.occurredAt,
          visitorHash: ctx.visitorHash,
          isBot: ctx.info.bot,
          path: requestPath(request),
          filters: filterSignature,
        });
      }
      rememberClient(lastFilters, ctx.visitorHash, filterSignature);

      const sortSignature = sortSignatureFor(query);
      const previousSort = lastSorts.get(ctx.visitorHash);
      const sortChanged =
        previousSort === undefined
          ? sortSignature !== DEFAULT_SORT_SIGNATURE
          : previousSort !== sortSignature;
      if (sortChanged) {
        recordAnalyticsEvent(db, {
          kind: 'sort',
          occurredAt: ctx.occurredAt,
          visitorHash: ctx.visitorHash,
          isBot: ctx.info.bot,
          path: requestPath(request),
          sort: sortSignature,
        });
      }
      rememberClient(lastSorts, ctx.visitorHash, sortSignature);

      const queryText = query.q?.trim() ?? '';
      if (queryText) {
        scheduleSearch(ctx.visitorHash, () => {
          recordAnalyticsEvent(db, {
            kind: 'search',
            occurredAt: ctx.occurredAt,
            isBot: ctx.info.bot,
            query: queryText,
            filters: filterSignature || null,
            sort: sortSignature,
            resultCount: total,
            zeroResults: total === 0,
          });
        });
      }
    },

    captureBeacon(request, body) {
      const ctx = context(request);
      if (!beaconAllowed(ctx.visitorHash)) return 'rate-limited';

      const event = parseBeaconBody(body);
      if (!event) return 'invalid';

      recordAnalyticsEvent(db, {
        kind: event.event,
        occurredAt: ctx.occurredAt,
        isBot: ctx.info.bot,
        detail: beaconDetail(event),
      });

      return 'accepted';
    },

    flush() {
      for (const pending of pendingSearches.values()) {
        clearTimeout(pending.timer);
        pending.write();
      }
      pendingSearches.clear();
    },
  };
}
