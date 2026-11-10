import type { FacetCount } from './contract.js';

export const AUTHOR_NAME_SEPARATORS = ['&', ','] as const;

const SEPARATOR_PATTERN = new RegExp(
  `[${AUTHOR_NAME_SEPARATORS.map((separator) =>
    separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('')}]`,
);

export function normalizeAuthorName(name: string): string {
  return name.trim().toLowerCase();
}

export function uniqueCaseInsensitive(
  values: readonly string[],
): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = normalizeAuthorName(trimmed);
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(trimmed);
  }

  return unique;
}

export function splitAuthorNames(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  return uniqueCaseInsensitive(value.split(SEPARATOR_PATTERN));
}

interface AuthorGroup {
  books: Set<string>;
  spellings: Map<string, number>;
}

function mostCommonSpelling(spellings: Map<string, number>): string {
  let best = '';
  let bestCount = -1;

  for (const [spelling, count] of spellings) {
    if (
      count > bestCount ||
      (count === bestCount &&
        spelling.toLowerCase() < best.toLowerCase())
    ) {
      best = spelling;
      bestCount = count;
    }
  }

  return best;
}

export function buildAuthorFacets(
  records: Iterable<{ joinId: string; author: string | null }>,
): FacetCount[] {
  const groups = new Map<string, AuthorGroup>();

  for (const record of records) {
    for (const name of splitAuthorNames(record.author)) {
      const key = normalizeAuthorName(name);
      let group = groups.get(key);
      if (!group) {
        group = { books: new Set(), spellings: new Map() };
        groups.set(key, group);
      }
      group.books.add(record.joinId);
      group.spellings.set(name, (group.spellings.get(name) ?? 0) + 1);
    }
  }

  return [...groups.values()]
    .map((group) => ({
      value: mostCommonSpelling(group.spellings),
      count: group.books.size,
    }))
    .sort((a, b) => {
      const left = a.value.toLowerCase();
      const right = b.value.toLowerCase();
      if (left < right) return -1;
      if (left > right) return 1;
      return 0;
    });
}
