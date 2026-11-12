import {
  isSortField,
  normalizeUnmatchedFilter,
  type SortDirection,
  type SortField,
  type UnmatchedFilter,
} from '../shared/contract.js';

export interface BooksQueryParams {
  q?: string;
  sort?: string;
  direction?: string;
  seed?: string;
  limit?: string;
  offset?: string;
  author?: string | string[];
  tag?: string | string[];
  subject?: string | string[];
  holds?: string | string[];
  available_only?: string | string[];
  rating_min?: string;
  include_low_sample?: string | string[];
  pages_min?: string;
  pages_max?: string;
  unmatched?: string;
}

export function parseInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

export function parseSort(value: string | undefined): SortField | undefined {
  if (value === undefined) return undefined;
  return isSortField(value) ? value : undefined;
}

export function parseNumber(
  value: string | undefined,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return undefined;
  }
  return parsed;
}

export function parseDirection(
  value: string | undefined,
): SortDirection | undefined {
  return value === 'asc' || value === 'desc' ? value : undefined;
}

export function parseUnmatched(value: string | undefined): UnmatchedFilter {
  return normalizeUnmatchedFilter(value);
}

export function toArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseBoolean(value: string | string[] | undefined): boolean {
  const first = Array.isArray(value) ? value[0] : value;
  return first === '1' || first === 'true' || first === 'yes';
}
