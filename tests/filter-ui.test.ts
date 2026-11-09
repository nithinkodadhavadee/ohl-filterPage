import { describe, expect, it } from 'vitest';
import {
  parseOptionalNumber,
  readStoredBoolean,
  subjectFacetSummary,
  writeStoredBoolean,
} from '../src/client/filter-ui.js';

function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('parseOptionalNumber', () => {
  it('treats empty and whitespace-only input as no bound', () => {
    expect(parseOptionalNumber('')).toBeUndefined();
    expect(parseOptionalNumber('   ')).toBeUndefined();
  });

  it('preserves zero as a real value', () => {
    expect(parseOptionalNumber('0')).toBe(0);
    expect(parseOptionalNumber(' 0 ')).toBe(0);
  });

  it('parses decimals and rejects non-numbers', () => {
    expect(parseOptionalNumber('3.5')).toBe(3.5);
    expect(parseOptionalNumber('12')).toBe(12);
    expect(parseOptionalNumber('not a number')).toBeUndefined();
  });
});

describe('subjectFacetSummary', () => {
  it('says when nothing is selected', () => {
    expect(subjectFacetSummary([])).toBe('0 selected');
  });

  it('shows the count and names for one or two selections', () => {
    expect(subjectFacetSummary(['Fantasy'])).toBe('1 selected: Fantasy');
    expect(subjectFacetSummary(['Fantasy', 'History'])).toBe(
      '2 selected: Fantasy, History',
    );
  });

  it('shows the first two names and the remaining count', () => {
    expect(subjectFacetSummary(['Fantasy', 'History', 'Poetry'])).toBe(
      '3 selected: Fantasy, History +1 more',
    );
    expect(
      subjectFacetSummary(['Fantasy', 'History', 'Poetry', 'Science']),
    ).toBe('4 selected: Fantasy, History +2 more');
  });
});

describe('stored boolean preferences', () => {
  it('reads a previously stored value', () => {
    const storage = fakeStorage({ panel: 'false' });
    expect(readStoredBoolean(storage, 'panel', true)).toBe(false);
  });

  it('falls back when the key is absent or malformed', () => {
    const storage = fakeStorage({ panel: 'sometimes' });
    expect(readStoredBoolean(storage, 'panel', true)).toBe(true);
    expect(readStoredBoolean(storage, 'missing', false)).toBe(false);
    expect(readStoredBoolean(null, 'panel', true)).toBe(true);
  });

  it('writes values that can be read back', () => {
    const storage = fakeStorage();
    writeStoredBoolean(storage, 'panel', false);
    expect(readStoredBoolean(storage, 'panel', true)).toBe(false);
    writeStoredBoolean(storage, 'panel', true);
    expect(readStoredBoolean(storage, 'panel', false)).toBe(true);
  });
});
