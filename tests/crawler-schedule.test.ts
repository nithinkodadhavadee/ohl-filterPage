import { describe, expect, it } from 'vitest';
import {
  backoffDelayForAttempt,
  decideNextDelay,
  type ScheduleOptions,
} from '../src/server/crawler-schedule.js';

function options(overrides: Partial<ScheduleOptions> = {}): ScheduleOptions {
  return {
    baseDelayMs: 30_000,
    maxDelayMs: 300_000,
    jitterRatio: 0.2,
    random: () => 0.5,
    ...overrides,
  };
}

describe('decideNextDelay', () => {
  it('uses the normal cycle delay after a successful read', () => {
    expect(decideNextDelay({ outcome: 'ok', attempt: 4 }, options())).toEqual({
      delayMs: 30_000,
      attempt: 0,
      backingOff: false,
      outcome: 'ok',
    });
  });

  it('enters backoff on throttling and grows exponentially', () => {
    const first = decideNextDelay(
      { outcome: 'throttled', attempt: 0 },
      options(),
    );
    expect(first).toMatchObject({
      delayMs: 30_000,
      attempt: 1,
      backingOff: true,
      outcome: 'throttled',
    });

    expect(
      decideNextDelay({ outcome: 'throttled', attempt: 1 }, options()).delayMs,
    ).toBe(60_000);
    expect(
      decideNextDelay({ outcome: 'throttled', attempt: 2 }, options()).delayMs,
    ).toBe(120_000);
    expect(
      decideNextDelay({ outcome: 'throttled', attempt: 3 }, options()).delayMs,
    ).toBe(240_000);
  });

  it('backs off on a generic error as well as throttling', () => {
    expect(decideNextDelay({ outcome: 'error', attempt: 0 }, options())).toMatchObject({
      delayMs: 30_000,
      attempt: 1,
      backingOff: true,
      outcome: 'error',
    });
  });

  it('keeps jittered delays inside the configured bounds', () => {
    const low = decideNextDelay(
      { outcome: 'throttled', attempt: 0 },
      options({ random: () => 0 }),
    );
    const high = decideNextDelay(
      { outcome: 'throttled', attempt: 0 },
      options({ random: () => 1 }),
    );

    expect(low.delayMs).toBe(24_000);
    expect(high.delayMs).toBe(36_000);

    const capped = decideNextDelay(
      { outcome: 'throttled', attempt: 5 },
      options({ random: () => 1 }),
    );
    expect(capped.delayMs).toBe(300_000);
  });

  it('recovers to normal pacing after a success', () => {
    expect(decideNextDelay({ outcome: 'ok', attempt: 9 }, options())).toEqual({
      delayMs: 30_000,
      attempt: 0,
      backingOff: false,
      outcome: 'ok',
    });
  });

  it('can compute the delay for a persisted attempt on restart', () => {
    expect(backoffDelayForAttempt(2, options())).toBe(60_000);
    expect(backoffDelayForAttempt(0, options())).toBe(30_000);
  });
});
