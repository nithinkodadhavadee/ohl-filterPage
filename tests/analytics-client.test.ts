import { describe, expect, it } from 'vitest';
import {
  bookViewScrollPercent,
  scrollQuartilesReached,
} from '../src/client/analytics.js';

describe('Book view scroll depth', () => {
  it('reports nothing when the dialog cannot scroll', () => {
    expect(bookViewScrollPercent(0, 500, 500)).toBeNull();
  });

  it('measures progress inside the dialog scroll container', () => {
    expect(bookViewScrollPercent(0, 1000, 400)).toBe(0);
    expect(bookViewScrollPercent(300, 1000, 400)).toBe(50);
    expect(bookViewScrollPercent(600, 1000, 400)).toBe(100);
  });

  it('reports only quartiles the scroll position has reached', () => {
    expect(scrollQuartilesReached(0)).toEqual([]);
    expect(scrollQuartilesReached(24)).toEqual([]);
    expect(scrollQuartilesReached(25)).toEqual([25]);
    expect(scrollQuartilesReached(80)).toEqual([25, 50, 75]);
    expect(scrollQuartilesReached(100)).toEqual([25, 50, 75, 100]);
  });
});
