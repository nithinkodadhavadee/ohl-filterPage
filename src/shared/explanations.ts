export type BadgeKind =
  | 'available'
  | 'unavailable'
  | 'low-sample'
  | 'unmatched';

export const BADGE_LABELS: Record<BadgeKind, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  'low-sample': 'Low sample',
  unmatched: 'Unmatched',
};

export const BADGE_EXPLANATIONS: Record<BadgeKind, string> = {
  available:
    'At least one copy is on the shelf and not already claimed by the hold queue.',
  unavailable:
    'Every copy is on loan, or the hold queue has claimed the copies on the shelf.',
  'low-sample':
    'Based on fewer than five ratings, so the average can be misleading.',
  unmatched:
    'No matching record was found in Open Library, so Rating, Subjects and page count are unavailable.',
};

export type EnrichmentHintField = 'rating' | 'subjects' | 'pageCount';

export const ENRICHMENT_HINT_LABELS: Record<EnrichmentHintField, string> = {
  rating: 'Rating',
  subjects: 'Subjects',
  pageCount: 'Page count',
};

export function enrichmentHintText(
  field: EnrichmentHintField,
  source: string | null,
): string {
  const sourceName = source ?? 'the enrichment source';

  switch (field) {
    case 'rating':
      return `Sourced from ${sourceName}. Ratings may be sparse or describe a different edition.`;
    case 'subjects':
      return `Sourced from ${sourceName}; raw subjects, not genres.`;
    case 'pageCount':
      return `Sourced from ${sourceName}; may be missing or describe a different edition.`;
  }
}
