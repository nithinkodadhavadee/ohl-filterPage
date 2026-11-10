import { describe, expect, it } from 'vitest';
import { parseSweepArgs } from '../src/server/refresh-cli.js';

describe('parseSweepArgs', () => {
  it('sweeps the whole Crawl set with no arguments', () => {
    expect(parseSweepArgs([])).toEqual({ book: null, delayMs: null });
  });

  it('accepts a single book with --book', () => {
    expect(parseSweepArgs(['--book', '12345'])).toEqual({
      book: '12345',
      delayMs: null,
    });
  });

  it('accepts a single book with --book=', () => {
    expect(parseSweepArgs(['--book=12345'])).toEqual({
      book: '12345',
      delayMs: null,
    });
  });

  it('accepts a delay override with --delay', () => {
    expect(parseSweepArgs(['--delay', '250'])).toEqual({
      book: null,
      delayMs: 250,
    });
  });

  it('accepts a delay override with --delay= and allows zero', () => {
    expect(parseSweepArgs(['--delay=0'])).toEqual({
      book: null,
      delayMs: 0,
    });
  });

  it('accepts a book and a delay together in either order', () => {
    expect(parseSweepArgs(['--delay', '10', '--book', '99'])).toEqual({
      book: '99',
      delayMs: 10,
    });
    expect(parseSweepArgs(['--book=99', '--delay=10'])).toEqual({
      book: '99',
      delayMs: 10,
    });
  });

  it('rejects a missing book id', () => {
    expect(() => parseSweepArgs(['--book'])).toThrow(/--book requires a value/);
    expect(() => parseSweepArgs(['--book='])).toThrow(/--book requires a value/);
  });

  it('rejects a missing or invalid delay', () => {
    expect(() => parseSweepArgs(['--delay'])).toThrow(/--delay requires a value/);
    expect(() => parseSweepArgs(['--delay', '-1'])).toThrow(
      /--delay requires a whole number/,
    );
    expect(() => parseSweepArgs(['--delay', 'soon'])).toThrow(
      /--delay requires a whole number/,
    );
    expect(() => parseSweepArgs(['--delay=1.5'])).toThrow(
      /--delay requires a whole number/,
    );
  });

  it('rejects unknown arguments', () => {
    expect(() => parseSweepArgs(['--all'])).toThrow(/Unknown argument "--all"/);
  });
});
