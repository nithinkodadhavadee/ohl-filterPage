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

export const STATUS_RUN_KINDS: readonly RunKind[] = [
  'catalogue_scan',
  'enrichment_pass',
  'book_sweep_cycle',
  'snapshot',
  'restore',
  'export',
  'override_import',
];

export function isRunKind(value: string): value is RunKind {
  return (RUN_KINDS as readonly string[]).includes(value);
}

export function isRunTrigger(value: string): value is RunTrigger {
  return (RUN_TRIGGERS as readonly string[]).includes(value);
}

export function isRunStatus(value: string): value is RunStatus {
  return (RUN_STATUSES as readonly string[]).includes(value);
}
