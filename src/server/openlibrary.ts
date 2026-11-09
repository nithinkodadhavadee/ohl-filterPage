import type {
  EnrichmentAdapter,
  EnrichmentCandidate,
  EnrichmentData,
  EnrichmentSearchInput,
} from './enrichment.js';

export const OPEN_LIBRARY_BASE_URL = 'https://openlibrary.org';
export const OPEN_LIBRARY_USER_AGENT =
  'OpenHouseLibraryDiscovery/0.1 (local prototype; read-only enrichment)';
export const OPEN_LIBRARY_SEARCH_FIELDS = [
  'key',
  'title',
  'author_name',
  'number_of_pages_median',
  'ratings_average',
  'ratings_count',
  'subject',
  'edition_count',
];

export class OpenLibraryRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'OpenLibraryRequestError';
    this.status = status;
  }
}

export interface OpenLibraryWork {
  key: string | null;
  title: string | null;
  subjects: string[];
  description: string | null;
}

export interface OpenLibraryRatings {
  average: number | null;
  count: number;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function parseSearchResponse(body: unknown): EnrichmentCandidate[] {
  const envelope = asRecord(body);
  const docs = envelope?.docs;
  if (!Array.isArray(docs)) return [];

  const candidates: EnrichmentCandidate[] = [];
  for (const entry of docs) {
    const doc = asRecord(entry);
    if (!doc) continue;

    const sourceId = asString(doc.key);
    const title = asString(doc.title);
    if (!sourceId || !title) continue;

    candidates.push({
      sourceId,
      title,
      authors: asStringArray(doc.author_name),
      ratingAverage: asNumber(doc.ratings_average),
      ratingCount: asNumber(doc.ratings_count),
      pageCount: asNumber(doc.number_of_pages_median),
      subjects: asStringArray(doc.subject),
      editionCount: asNumber(doc.edition_count),
    });
  }

  return candidates;
}

function descriptionText(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return direct;

  const wrapped = asRecord(value);
  return wrapped ? asString(wrapped.value) : null;
}

export function parseWorkResponse(body: unknown): OpenLibraryWork | null {
  const work = asRecord(body);
  if (!work) return null;

  return {
    key: asString(work.key),
    title: asString(work.title),
    subjects: asStringArray(work.subjects),
    description: descriptionText(work.description),
  };
}

export function parseRatingsResponse(body: unknown): OpenLibraryRatings | null {
  const ratings = asRecord(body);
  const summary = asRecord(ratings?.summary);
  if (!summary) return null;

  const count = asNumber(summary.count) ?? 0;
  const average = count > 0 ? asNumber(summary.average) : null;

  return { average, count };
}

export interface OpenLibraryAdapterOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
  limit?: number;
}

const OPEN_LIBRARY_WORK_URL =
  /\/works\/(OL\d+W)(?:\.json)?(?:\/|$)/i;
const OPEN_LIBRARY_WORK_ID = /^OL\d+W$/i;

export function normalizeOpenLibrarySourceId(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (OPEN_LIBRARY_WORK_ID.test(trimmed)) {
    return `/works/${trimmed}`;
  }

  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed) || /openlibrary\.org/i.test(trimmed)) {
    try {
      pathname = new URL(
        /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
      ).pathname;
    } catch {
      return null;
    }
  }

  const match = pathname.match(OPEN_LIBRARY_WORK_URL);
  return match ? `/works/${match[1]}` : null;
}

function workPath(sourceId: string): string {
  const normalized = normalizeOpenLibrarySourceId(sourceId);
  if (normalized) return normalized;
  return sourceId.startsWith('/works/') ? sourceId : `/works/${sourceId}`;
}

function assertOk(response: Response, url: string): void {
  if (response.ok) return;

  throw new OpenLibraryRequestError(
    response.status,
    `Open Library request failed (HTTP ${response.status}) for ${url}.`,
  );
}

export class OpenLibraryAdapter implements EnrichmentAdapter {
  readonly source = 'openlibrary';

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;
  private readonly limit: number;

  constructor(options: OpenLibraryAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? OPEN_LIBRARY_BASE_URL).replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? OPEN_LIBRARY_USER_AGENT;
    this.limit = options.limit ?? 10;
  }

  private async getJson(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': this.userAgent,
      },
    });
    assertOk(response, url);
    return response.json();
  }

  async search(input: EnrichmentSearchInput): Promise<EnrichmentCandidate[]> {
    const params = new URLSearchParams({
      title: input.title,
      limit: String(this.limit),
      fields: OPEN_LIBRARY_SEARCH_FIELDS.join(','),
    });
    if (input.author) params.set('author', input.author);

    const body = await this.getJson(
      `${this.baseUrl}/search.json?${params.toString()}`,
    );
    return parseSearchResponse(body);
  }

  private async fetchWork(candidate: EnrichmentCandidate): Promise<OpenLibraryWork | null> {
    const url = `${this.baseUrl}${workPath(candidate.sourceId)}.json`;
    const response = await this.fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': this.userAgent,
      },
    });
    if (response.status === 404) return null;
    assertOk(response, url);
    return parseWorkResponse(await response.json());
  }

  private async fetchRatings(
    candidate: EnrichmentCandidate,
  ): Promise<OpenLibraryRatings | null> {
    const url = `${this.baseUrl}${workPath(candidate.sourceId)}/ratings.json`;
    const response = await this.fetchImpl(url, {
      headers: {
        accept: 'application/json',
        'user-agent': this.userAgent,
      },
    });
    if (response.status === 404) return null;
    assertOk(response, url);
    return parseRatingsResponse(await response.json());
  }

  async fetch(candidate: EnrichmentCandidate): Promise<EnrichmentData> {
    const [work, ratings] = await Promise.all([
      this.fetchWork(candidate),
      this.fetchRatings(candidate),
    ]);

    const subjects =
      work && work.subjects.length > 0 ? work.subjects : candidate.subjects;

    return {
      ratingAverage: ratings ? ratings.average : candidate.ratingAverage,
      ratingCount: ratings ? ratings.count : candidate.ratingCount,
      pageCount: candidate.pageCount,
      subjects,
      title: work?.title ?? null,
      authors: [],
    };
  }

  normalizeSourceId(input: string): string | null {
    return normalizeOpenLibrarySourceId(input);
  }
}
