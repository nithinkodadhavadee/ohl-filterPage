import type {
  RunCounts,
  RunHistoryPage,
  RunKind,
  RunLogEntry,
  RunStatus,
} from '../shared/run-log';

export { RUN_HISTORY_PAGE_SIZE } from '../shared/run-log';

export type StatusSectionPanel = 'enrichment' | 'sweep';

export interface StatusSection {
  kind: RunKind;
  label: string;
  description: string;
  panel?: StatusSectionPanel;
}

export const STATUS_SECTIONS: readonly StatusSection[] = [
  {
    kind: 'catalogue_scan',
    label: 'Catalogue scan',
    description:
      'Reads the Libib Catalogue index, adding, updating and hiding book records.',
  },
  {
    kind: 'enrichment_pass',
    label: 'Enrichment pass',
    description: 'Ratings, page counts and subjects from enrichment sources.',
    panel: 'enrichment',
  },
  {
    kind: 'book_sweep_cycle',
    label: 'Book sweep',
    description:
      'Rolling refresh of each book record’s circulation and library metadata.',
    panel: 'sweep',
  },
  {
    kind: 'snapshot',
    label: 'Snapshot',
    description: 'Automatic database snapshots.',
  },
  {
    kind: 'restore',
    label: 'Restore',
    description: 'Database restores from a snapshot.',
  },
  {
    kind: 'export',
    label: 'Export',
    description: 'Catalogue exports.',
  },
  {
    kind: 'override_import',
    label: 'Override import',
    description: 'Manual match override imports.',
  },
];

export function latestRun(runs: readonly RunLogEntry[]): RunLogEntry | null {
  return runs[0] ?? null;
}

export function appendRunHistory(
  current: readonly RunLogEntry[],
  page: RunHistoryPage,
): RunLogEntry[] {
  const seen = new Set(current.map((run) => run.id));
  const merged = [...current];
  for (const run of page.runs) {
    if (seen.has(run.id)) continue;
    seen.add(run.id);
    merged.push(run);
  }
  return merged;
}

export function formatRunDuration(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const ms = Math.max(0, value);
  if (ms < 1000) return `${Math.round(ms)} ms`;

  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatRemaining(
  estimatedRemainingMs: number | null,
  stalled: boolean,
): string {
  if (stalled) return 'Stalled';
  if (estimatedRemainingMs === null) return 'Not available';
  return `~${formatRunDuration(estimatedRemainingMs)} remaining`;
}

export function formatRunStatus(status: RunStatus): string {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'partial':
      return 'Partial';
    case 'failed':
      return 'Failed';
    case 'running':
      return 'Running';
  }
}

export function humanizeCountKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function countEntries(
  counts: RunCounts | null,
): Array<{ key: string; label: string; value: number }> {
  if (!counts) return [];
  return Object.entries(counts).map(([key, value]) => ({
    key,
    label: humanizeCountKey(key),
    value,
  }));
}
