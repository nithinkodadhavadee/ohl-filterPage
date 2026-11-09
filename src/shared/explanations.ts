import type { EnrichmentStatus } from './contract.js';
import { enrichmentSourceDisplayName } from './enrichment.js';

export type BadgeKind =
  | 'available'
  | 'unavailable'
  | 'low-sample'
  | 'unmatched';

export const BADGE_COPY: Record<BadgeKind, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  'low-sample': 'Low sample',
  unmatched: 'Unmatched',
};

export interface BadgeExplanationOptions {
  status?: EnrichmentStatus | null;
  source?: string | null;
}

export function badgeExplanation(
  kind: BadgeKind,
  { status = null, source = null }: BadgeExplanationOptions = {},
): string {
  switch (kind) {
    case 'available':
      return 'At least one copy is on the shelf and not already claimed by the hold queue.';
    case 'unavailable':
      return 'Every copy is on loan, or the hold queue has claimed the copies on the shelf.';
    case 'low-sample':
      return 'Based on fewer than five ratings, so the average can be misleading.';
    case 'unmatched': {
      const sourceName = enrichmentSourceDisplayName(source);

      if (status === 'unmatched') {
        return `No matching record was found in ${sourceName}, so Rating, Subjects and page count are unavailable.`;
      }
      if (status === 'failed') {
        return source
          ? `Enrichment from ${sourceName} has not completed, so Rating, Subjects and page count are unavailable.`
          : 'Enrichment has not completed, so Rating, Subjects and page count are unavailable.';
      }
      return 'Enrichment has not completed yet, so Rating, Subjects and page count are unavailable.';
    }
  }
}

export type EnrichmentHintField = 'rating' | 'subjects' | 'pageCount';

export const ENRICHMENT_HINT_COPY: Record<EnrichmentHintField, string> = {
  rating: 'Rating',
  subjects: 'Subjects',
  pageCount: 'Page count',
};

export function enrichmentHintText(
  field: EnrichmentHintField,
  source: string | null,
): string {
  const sourceName = enrichmentSourceDisplayName(source);

  switch (field) {
    case 'rating':
      return `Sourced from ${sourceName}. Ratings may be sparse or describe a different edition.`;
    case 'subjects':
      return `Sourced from ${sourceName}; raw subjects, not genres.`;
    case 'pageCount':
      return `Sourced from ${sourceName}; may be missing or describe a different edition.`;
  }
}
