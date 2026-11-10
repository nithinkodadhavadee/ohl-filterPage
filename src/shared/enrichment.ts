const ENRICHMENT_SOURCE_LABELS: Record<string, string> = {
  openlibrary: 'Open Library',
};

const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
const OPEN_LIBRARY_WORK_URL = /\/works\/(OL\d+W)(?:\.json)?(?:\/|$)/i;
const OPEN_LIBRARY_WORK_ID = /^OL\d+W$/i;

function openLibraryWorkPath(sourceId: string): string | null {
  const trimmed = sourceId.trim();
  if (!trimmed) return null;

  if (OPEN_LIBRARY_WORK_ID.test(trimmed)) {
    return `/works/${trimmed}`;
  }

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed) || /openlibrary\.org/i.test(trimmed)) {
    try {
      pathname = new URL(
        /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
      ).pathname;
    } catch {
      return null;
    }
  }

  const match = pathname.match(OPEN_LIBRARY_WORK_URL);
  return match ? `/works/${match[1]}` : null;
}

export function enrichmentSourceUrl(
  source: string | null | undefined,
  sourceId: string | null | undefined,
): string | null {
  const trimmedSource = source?.trim().toLowerCase();
  const trimmedId = sourceId?.trim();
  if (!trimmedSource || !trimmedId) return null;

  if (trimmedSource === 'openlibrary') {
    const path = openLibraryWorkPath(trimmedId);
    return path ? `${OPEN_LIBRARY_BASE_URL}${path}` : null;
  }

  return /^https?:\/\//i.test(trimmedId) ? trimmedId : null;
}

function titleCaseSource(source: string): string {
  return source
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function enrichmentSourceLabel(
  source: string | null | undefined,
): string | null {
  const trimmed = source?.trim();
  if (!trimmed) return null;
  return ENRICHMENT_SOURCE_LABELS[trimmed.toLowerCase()] ?? titleCaseSource(trimmed);
}

export function enrichmentSourceDisplayName(
  source: string | null | undefined,
): string {
  return enrichmentSourceLabel(source) ?? 'the enrichment source';
}
