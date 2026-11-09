const ENRICHMENT_SOURCE_LABELS: Record<string, string> = {
  openlibrary: 'Open Library',
};

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
