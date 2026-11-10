import { describe, expect, it } from 'vitest';
import { describeSweep } from '../src/client/sweep-state.js';

describe('describeSweep', () => {
  it('labels a record with no ledger as not yet swept', () => {
    expect(describeSweep(null)).toEqual({
      hasSuccessfulSweep: false,
      label: 'Not yet swept',
      lastSuccessAt: null,
      lastAttemptAt: null,
      outcome: null,
    });
  });

  it('keeps an unswept record distinct even after a failed attempt', () => {
    expect(
      describeSweep({
        lastAttemptAt: '2026-11-10T10:00:00.000Z',
        outcome: 'failed',
        reason: 'parse failure',
        lastSuccessAt: null,
      }),
    ).toMatchObject({
      hasSuccessfulSweep: false,
      label: 'Not yet swept',
      lastAttemptAt: '2026-11-10T10:00:00.000Z',
      outcome: 'failed',
    });
  });

  it('reports the last successful sweep time when one exists', () => {
    expect(
      describeSweep({
        lastAttemptAt: '2026-11-10T10:05:00.000Z',
        outcome: 'skipped',
        reason: 'Libib returned no detail',
        lastSuccessAt: '2026-11-10T10:00:00.000Z',
      }),
    ).toEqual({
      hasSuccessfulSweep: true,
      label: 'Last swept',
      lastSuccessAt: '2026-11-10T10:00:00.000Z',
      lastAttemptAt: '2026-11-10T10:05:00.000Z',
      outcome: 'skipped',
    });
  });
});
