import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  filterQueryForView,
  parseViewState,
  viewToUrl,
} from '../src/client/view-state.js';

describe('include low-sample default', () => {
  it('includes low-sample ratings on a fresh load', () => {
    const state = parseViewState('');

    expect(state.includeLowSample).toBe(true);
    expect(filterQueryForView(state).includeLowSample).toBe(true);
  });

  it('omits the flag from a default URL', () => {
    const url = new URL(viewToUrl(parseViewState(''), '/'), 'http://localhost');

    expect(url.searchParams.has('include_low_sample')).toBe(false);
    expect(parseViewState(url.search).includeLowSample).toBe(true);
  });

  it('round-trips the explicit off state through the URL', () => {
    const state = parseViewState('?include_low_sample=0');

    expect(state.includeLowSample).toBe(false);
    expect(filterQueryForView(state).includeLowSample).toBe(false);

    const url = new URL(viewToUrl(state, '/'), 'http://localhost');
    expect(url.searchParams.get('include_low_sample')).toBe('0');
    expect(parseViewState(url.search).includeLowSample).toBe(false);
  });

  it('treats an explicit on value as including low-sample ratings', () => {
    expect(parseViewState('?include_low_sample=1').includeLowSample).toBe(true);
    expect(parseViewState('?include_low_sample=true').includeLowSample).toBe(
      true,
    );
  });

  it('only counts an explicit exclusion as an active filter', () => {
    expect(activeFilterCount(parseViewState(''))).toBe(0);
    expect(activeFilterCount(parseViewState('?include_low_sample=0'))).toBe(1);
  });
});
