export const RUN_KINDS = [
  'catalogue_scan',
  'enrichment_pass',
  'book_sweep_cycle',
  'snapshot',
  'restore',
  'export',
  'override_import',
] as const;

export type RunKind = (typeof RUN_KINDS)[number];

export const RUN_TRIGGERS = [
  'startup',
  'scheduled',
  'manual',
  'automatic',
] as const;

export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const RUN_STATUSES = ['running', 'ok', 'partial', 'failed'] as const;

export const RUN_HISTORY_PAGE_SIZE = 20;

export type RunStatus = (typeof RUN_STATUSES)[number];

export type RunCounts = Record<string, number>;

export interface RunLogEntry {
  id: number;
  kind: RunKind;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  duration: number | null;
  counts: RunCounts | null;
  error: string | null;
  note: string | null;
}

export interface RunHistoryPage {
  kind: RunKind;
  runs: RunLogEntry[];
  nextOffset: number | null;
}

export const STATUS_RUN_KINDS: readonly RunKind[] = RUN_KINDS;

export function isRunKind(value: string): value is RunKind {
  return (RUN_KINDS as readonly string[]).includes(value);
}
