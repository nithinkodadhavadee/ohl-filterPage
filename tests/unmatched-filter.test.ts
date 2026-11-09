import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeededApp, titles, type SeededApp } from './seeded-app.js';

let seeded: SeededApp;

beforeEach(async () => {
  seeded = await createSeededApp('unmatched-filter');
});

afterEach(async () => {
  await seeded.close();
});

const listBooks = (query = '') => seeded.listBooks(query);

describe('unmatched filter', () => {
  it('defaults to all books', async () => {
    const body = await listBooks();

    expect(body.total).toBe(6);
    expect(titles(body)).toContain('In Cold Blood');
  });

  it('hides unmatched books', async () => {
    const body = await listBooks('?unmatched=hide');

    expect(body.total).toBe(5);
    expect(titles(body)).not.toContain('In Cold Blood');
  });

  it('keeps only unmatched books', async () => {
    const body = await listBooks('?unmatched=only');

    expect(body.total).toBe(1);
    expect(titles(body)).toEqual(['In Cold Blood']);
  });

  it('combines with free-text search', async () => {
    expect(titles(await listBooks('?unmatched=hide&q=tolkien'))).toEqual([
      'The Hobbit',
    ]);
    expect((await listBooks('?unmatched=only&q=tolkien')).total).toBe(0);
  });

  it('combines with another filter category', async () => {
    expect((await listBooks('?unmatched=hide&tag=nonfiction')).total).toBe(0);
    expect(titles(await listBooks('?unmatched=only&tag=nonfiction'))).toEqual([
      'In Cold Blood',
    ]);
  });

  it('accepts an explicit all value', async () => {
    const body = await listBooks('?unmatched=all');

    expect(body.total).toBe(6);
  });

  it('falls back to all books for an unknown value', async () => {
    expect((await listBooks('?unmatched=HIDE')).total).toBe(6);
    expect((await listBooks('?unmatched=bogus')).total).toBe(6);
    expect((await listBooks('?unmatched=')).total).toBe(6);
  });
});
