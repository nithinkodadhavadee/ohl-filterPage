import type { BookSweepState, SweepOutcome } from '../shared/contract';

export interface SweepDescription {
  hasSuccessfulSweep: boolean;
  label: string;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  outcome: SweepOutcome | null;
}

export function describeSweep(
  sweep: BookSweepState | null | undefined,
): SweepDescription {
  const hasSuccessfulSweep = Boolean(sweep?.lastSuccessAt);
  return {
    hasSuccessfulSweep,
    label: hasSuccessfulSweep ? 'Last swept' : 'Not yet swept',
    lastSuccessAt: sweep?.lastSuccessAt ?? null,
    lastAttemptAt: sweep?.lastAttemptAt ?? null,
    outcome: sweep?.outcome ?? null,
  };
}
