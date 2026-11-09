import { describe, expect, it } from 'vitest';
import {
  BADGE_COPY,
  badgeExplanation,
  enrichmentHintText,
} from '../src/shared/explanations.js';

describe('badge copy', () => {
  it('names each badge', () => {
    expect(BADGE_COPY.available).toBe('Available');
    expect(BADGE_COPY.unavailable).toBe('Unavailable');
    expect(BADGE_COPY['low-sample']).toBe('Low sample');
    expect(BADGE_COPY.unmatched).toBe('Unmatched');
  });

  it('uses the fixed copy for the availability and sample badges', () => {
    expect(badgeExplanation('available')).toBe(
      'At least one copy is on the shelf and not already claimed by the hold queue.',
    );
    expect(badgeExplanation('unavailable')).toBe(
      'Every copy is on loan, or the hold queue has claimed the copies on the shelf.',
    );
    expect(badgeExplanation('low-sample')).toBe(
      'Based on fewer than five ratings, so the average can be misleading.',
    );
  });

  it('names the source that found no matching record', () => {
    expect(
      badgeExplanation('unmatched', {
        status: 'unmatched',
        source: 'Open Library',
      }),
    ).toBe(
      'No matching record was found in Open Library, so Rating, Subjects and page count are unavailable.',
    );
  });

  it('does not claim there was no match when enrichment failed or is pending', () => {
    expect(
      badgeExplanation('unmatched', {
        status: 'failed',
        source: 'openlibrary',
      }),
    ).toBe(
      'Enrichment from Open Library has not completed, so Rating, Subjects and page count are unavailable.',
    );
    expect(badgeExplanation('unmatched', { status: null })).toBe(
      'Enrichment has not completed yet, so Rating, Subjects and page count are unavailable.',
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
