import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeVisitorHash,
  isBotUserAgent,
  parseUserAgent,
  purgeExpiredAnalytics,
  readAnalyticsSummary,
  recordAnalyticsEvent,
  utcDay,
  visitorHashFor,
  visitorSalt,
} from '../src/server/analytics.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';

let dataDir: string;
let db: DatabaseSync;

beforeEach(() => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-analytics-unit-'));
  db = openDatabase(loadConfig({ dataDir }));
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1';

describe('bot classifier', () => {
  it('recognises known crawler User-Agents', () => {
    expect(
      isBotUserAgent(
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ),
    ).toBe(true);
    expect(isBotUserAgent('curl/8.4.0')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; AhrefsBot/7.0)')).toBe(true);
    expect(isBotUserAgent('node-fetch/1.0')).toBe(true);
  });

  it('treats ordinary browsers as human and empty User-Agents as unknown', () => {
    expect(isBotUserAgent(CHROME_MAC)).toBe(false);
    expect(isBotUserAgent(IPHONE_SAFARI)).toBe(false);
    expect(isBotUserAgent(undefined)).toBe(false);
  });
});

describe('User-Agent parser', () => {
  it('derives device, browser and OS', () => {
    expect(parseUserAgent(CHROME_MAC)).toEqual({
      device: 'desktop',
      browser: 'Chrome',
      os: 'macOS',
      bot: false,
    });
    expect(parseUserAgent(IPHONE_SAFARI)).toEqual({
      device: 'mobile',
      browser: 'Safari',
      os: 'iOS',
      bot: false,
    });
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/119.0 Safari/537.36',
      ),
    ).toMatchObject({ device: 'tablet', browser: 'Chrome', os: 'Android' });
  });

  it('marks bots without storing the raw User-Agent', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      ),
    ).toEqual({ device: 'bot', browser: 'bot', os: 'bot', bot: true });
  });
});

describe('daily salted visitor hash', () => {
  const firstDay = new Date('2026-01-01T10:00:00.000Z');
  const secondDay = new Date('2026-01-02T10:00:00.000Z');

  it('keeps the salt for the UTC day and rotates it afterwards', () => {
    const salt = visitorSalt(db, firstDay);
    expect(visitorSalt(db, firstDay)).toBe(salt);
    expect(utcDay(firstDay)).toBe('2026-01-01');

    const nextSalt = visitorSalt(db, secondDay);
    expect(nextSalt).not.toBe(salt);
    expect(visitorSalt(db, secondDay)).toBe(nextSalt);
  });

  it('hashes IP and User-Agent with the daily salt, never storing either', () => {
    const salt = visitorSalt(db, firstDay);
    const hash = computeVisitorHash(salt, '203.0.113.9', CHROME_MAC);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(computeVisitorHash(salt, '203.0.113.9', CHROME_MAC)).toBe(hash);
    expect(computeVisitorHash(salt, '203.0.113.10', CHROME_MAC)).not.toBe(hash);

    const first = visitorHashFor(db, '203.0.113.9', CHROME_MAC, firstDay);
    const second = visitorHashFor(db, '203.0.113.9', CHROME_MAC, secondDay);
    expect(first).toBe(hash);
    expect(second).not.toBe(first);

    const meta = db
      .prepare('SELECT value FROM analytics_meta')
      .all() as unknown as { value: string }[];
    for (const entry of meta) {
      expect(entry.value).not.toContain('203.0.113.9');
      expect(entry.value).not.toContain('Chrome');
    }
    expect(meta.length).toBeGreaterThan(0);
  });
});

describe('privacy', () => {
  it('stores Search text without any visitor hash or identifier', () => {
    recordAnalyticsEvent(db, {
      kind: 'search',
      occurredAt: new Date('2026-01-01T10:00:00.000Z'),
      query: 'a search term',
      isBot: false,
      resultCount: 0,
      zeroResults: true,
    });
    const row = db
      .prepare('SELECT visitor_hash, query FROM analytics_events')
      .get() as unknown as { visitor_hash: string | null; query: string };
    expect(row.query).toBe('a search term');
    expect(row.visitor_hash).toBeNull();
  });

  it('never writes the IP or raw User-Agent into events', () => {
    const now = new Date('2026-01-01T10:00:00.000Z');
    const hash = visitorHashFor(db, '203.0.113.9', CHROME_MAC, now);
    const info = parseUserAgent(CHROME_MAC);
    recordAnalyticsEvent(db, {
      kind: 'visit',
      occurredAt: now,
      visitorHash: hash,
      isBot: info.bot,
      device: info.device,
      browser: info.browser,
      os: info.os,
    });
    const rows = db
      .prepare('SELECT * FROM analytics_events')
      .all() as unknown as Array<Record<string, unknown>>;
    const serialised = JSON.stringify(rows);
    expect(serialised).not.toContain('203.0.113.9');
    expect(serialised).not.toContain('Mozilla/5.0');
    expect(serialised).not.toContain(CHROME_MAC);
  });
});

describe('retention purge', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');

  function eventDaysAgo(days: number, kind: 'visit' | 'search' = 'visit') {
    recordAnalyticsEvent(db, {
      kind,
      occurredAt: new Date(now.getTime() - days * 86_400_000),
      visitorHash: 'a'.repeat(64),
      query: kind === 'search' ? 'term' : null,
    });
  }

  it('keeps raw data forever when retention is zero', () => {
    eventDaysAgo(365);
    expect(purgeExpiredAnalytics(db, 0, now)).toBe(0);
    expect(readAnalyticsSummary(db, now).pageViews.total).toBe(1);
  });

  it('deletes events older than the retention window', () => {
    eventDaysAgo(10);
    eventDaysAgo(1);
    expect(purgeExpiredAnalytics(db, 5, now)).toBe(1);
    expect(readAnalyticsSummary(db, now).pageViews.total).toBe(1);
  });
});
