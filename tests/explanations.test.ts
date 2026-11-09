import { describe, expect, it } from 'vitest';
import {
  BADGE_EXPLANATIONS,
  enrichmentHintText,
} from '../src/shared/explanations.js';

describe('badge explanations', () => {
  it('uses the fixed copy for each badge', () => {
    expect(BADGE_EXPLANATIONS.available).toBe(
      'At least one copy is on the shelf and not already claimed by the hold queue.',
    );
    expect(BADGE_EXPLANATIONS.unavailable).toBe(
      'Every copy is on loan, or the hold queue has claimed the copies on the shelf.',
    );
    expect(BADGE_EXPLANATIONS['low-sample']).toBe(
      'Based on fewer than five ratings, so the average can be misleading.',
    );
    expect(BADGE_EXPLANATIONS.unmatched).toBe(
      'No matching record was found in Open Library, so Rating, Subjects and page count are unavailable.',
    );
  });
});

describe('enrichment hint text', () => {
  it('interpolates the source name from the API', () => {
    expect(enrichmentHintText('rating', 'Open Library')).toBe(
      'Sourced from Open Library. Ratings may be sparse or describe a different edition.',
    );
    expect(enrichmentHintText('subjects', 'Open Library')).toBe(
      'Sourced from Open Library; raw subjects, not genres.',
    );
    expect(enrichmentHintText('pageCount', 'Open Library')).toBe(
      'Sourced from Open Library; may be missing or describe a different edition.',
    );
  });

  it('uses a generic source phrase when the source is unknown', () => {
    expect(enrichmentHintText('subjects', null)).toBe(
      'Sourced from the enrichment source; raw subjects, not genres.',
    );
  });
});
