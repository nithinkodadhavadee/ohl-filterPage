import { decodeHtmlEntities } from './html-entities.js';
import type { LibibIndexItem } from './libib-index.js';

export const SAMPLE_SIZE = 50;

const LEADING_ARTICLE = /^\s*(?:the|a|an)\s+/i;

export function titleSortKey(title: string): string {
  return decodeHtmlEntities(title)
    .normalize('NFKD')
    .replace(LEADING_ARTICLE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isFromAOnward(title: string): boolean {
  const first = Array.from(titleSortKey(title))[0];
  if (!first) return false;
  return /\p{L}/u.test(first);
}

export function selectSample(
  items: readonly LibibIndexItem[],
  size = SAMPLE_SIZE,
): LibibIndexItem[] {
  if (size <= 0) return [...items];

  const sample: LibibIndexItem[] = [];
  for (const item of items) {
    if (!isFromAOnward(item.title)) continue;
    sample.push(item);
    if (sample.length >= size) break;
  }
  return sample;
}
