export const FILTER_PANEL_STORAGE_KEY =
  'open-house-library.filter-panel.expanded';
export const SUBJECTS_FACET_STORAGE_KEY =
  'open-house-library.subjects-facet.expanded';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function subjectFacetSummary(selected: readonly string[]): string {
  if (selected.length === 0) return '0 selected';

  const count = `${selected.length} selected`;
  const names = selected.slice(0, 2).join(', ');
  const remaining = selected.length - 2;
  const more = remaining > 0 ? ` +${remaining} more` : '';

  return `${count}: ${names}${more}`;
}

export function readStoredBoolean(
  storage: ReadableStorage | null | undefined,
  key: string,
  fallback: boolean,
): boolean {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    return fallback;
  }
  return fallback;
}

export function writeStoredBoolean(
  storage: WritableStorage | null | undefined,
  key: string,
  value: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(key, value ? 'true' : 'false');
  } catch {
    // Session storage can be unavailable; the toggle still works for this view.
  }
}

export function browserSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
