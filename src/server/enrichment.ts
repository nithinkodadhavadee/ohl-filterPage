import type { DatabaseSync } from 'node:sqlite';
import { decodeHtmlEntities } from './html-entities.js';

export interface EnrichmentCandidate {
  sourceId: string;
  title: string;
  authors: string[];
  ratingAverage: number | null;
  ratingCount: number | null;
  pageCount: number | null;
  subjects: string[];
  editionCount: number | null;
}

export interface EnrichmentData {
  ratingAverage: number | null;
  ratingCount: number | null;
  pageCount: number | null;
  subjects: string[];
}

export interface EnrichmentSearchInput {
  title: string;
  author: string | null;
}

export interface EnrichmentAdapter {
  readonly source: string;
  search(input: EnrichmentSearchInput): Promise<EnrichmentCandidate[]>;
  fetch(candidate: EnrichmentCandidate): Promise<EnrichmentData>;
}

export interface EnrichBookOptions {
  now?: () => Date;
}

export type EnrichmentOutcome =
  | {
      status: 'enriched';
      joinId: string;
      candidate: EnrichmentCandidate;
      data: EnrichmentData;
    }
  | { status: 'unmatched'; joinId: string }
  | { status: 'failed'; joinId: string; error: string };

const LEADING_ARTICLE = /^(?:the|a|an)\s+/;
const ADAPTATION_MARKERS =
  /\b(adaptation|adapted|abridged|retold|retelling|graded reader|graded readers|bookworms|readers|level \d+)\b/;

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function plainText(value: string): string {
  return collapse(decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')));
}

export function normalizeTitle(value: string): string {
  const withoutBrackets = plainText(value).replace(/[([{][^)\]}]*[)\]}]/g, ' ');
  const words = stripAccents(withoutBrackets)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(LEADING_ARTICLE, '')
    .trim();
  return words;
}

export function authorSurname(value: string | null | undefined): string | null {
  if (!value) return null;

  const text = stripAccents(plainText(value))
    .toLowerCase()
    .replace(/['’‘]/g, '')
    .trim();
  if (!text) return null;

  const beforeComma = text.includes(',') ? text.slice(0, text.indexOf(',')) : text;
  const tokens = beforeComma
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return tokens.at(-1) ?? null;
}

export function isAdaptationTitle(value: string): boolean {
  return ADAPTATION_MARKERS.test(plainText(value).toLowerCase());
}

function authorMatches(candidate: EnrichmentCandidate, author: string): boolean {
  const target = authorSurname(author);
  if (!target) return false;
  return candidate.authors.some((name) => authorSurname(name) === target);
}

function ratingRank(candidate: EnrichmentCandidate): number {
  return candidate.ratingCount && candidate.ratingCount > 0
    ? candidate.ratingCount
    : 0;
}

export function selectCandidate(
  candidates: readonly EnrichmentCandidate[],
  input: EnrichmentSearchInput,
): EnrichmentCandidate | null {
  if (!input.author) return null;

  const wantedTitle = normalizeTitle(input.title);
  if (!wantedTitle) return null;

  const qualifying = candidates.filter(
    (candidate) =>
      normalizeTitle(candidate.title) === wantedTitle &&
      authorMatches(candidate, input.author as string),
  );
  if (qualifying.length === 0) return null;

  const realWorks = qualifying.filter(
    (candidate) => !isAdaptationTitle(candidate.title),
  );
  const pool = realWorks.length > 0 ? realWorks : qualifying;

  return [...pool].sort((left, right) => {
    const byRating = ratingRank(right) - ratingRank(left);
    if (byRating !== 0) return byRating;

    const byEditions =
      (right.editionCount ?? 0) - (left.editionCount ?? 0);
    if (byEditions !== 0) return byEditions;

    return left.sourceId.localeCompare(right.sourceId);
  })[0];
}

export function matchedAuthorFor(
  candidate: EnrichmentCandidate,
  bookAuthor: string | null,
): string | null {
  const target = authorSurname(bookAuthor);
  if (target) {
    const matching = candidate.authors.find(
      (name) => authorSurname(name) === target,
    );
    if (matching) return collapse(matching);
  }
  return candidate.authors[0] ? collapse(candidate.authors[0]) : null;
}

interface BookRow {
  join_id: string;
  title: string;
  author: string | null;
}

function readBook(db: DatabaseSync, joinId: string): BookRow | undefined {
  const statement = db.prepare(
    'SELECT join_id, title, author FROM book_records WHERE join_id = ?',
  );
  return statement.get(joinId) as unknown as BookRow | undefined;
}

function replaceSubjects(
  db: DatabaseSync,
  joinId: string,
  subjects: readonly string[],
): void {
  db.prepare('DELETE FROM book_subjects WHERE join_id = ?').run(joinId);
  const insert = db.prepare(
    'INSERT OR IGNORE INTO book_subjects (join_id, subject) VALUES (?, ?)',
  );
  for (const subject of new Set(subjects.map(collapse).filter(Boolean))) {
    insert.run(joinId, subject);
  }
}

function upsertEnrichment(
  db: DatabaseSync,
  values: {
    joinId: string;
    source: string;
    sourceId: string | null;
    matchedTitle: string | null;
    matchedAuthor: string | null;
    ratingAverage: number | null;
    ratingCount: number | null;
    pageCount: number | null;
    status: string;
    error: string | null;
    enrichedAt: string;
  },
): void {
  db.prepare(`
    INSERT INTO enrichment (
      join_id, source, source_id, matched_title, matched_author,
      rating_average, rating_count, page_count, status, error, enriched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(join_id) DO UPDATE SET
      source = excluded.source,
      source_id = excluded.source_id,
      matched_title = excluded.matched_title,
      matched_author = excluded.matched_author,
      rating_average = excluded.rating_average,
      rating_count = excluded.rating_count,
      page_count = excluded.page_count,
      status = excluded.status,
      error = excluded.error,
      enriched_at = excluded.enriched_at
  `).run(
    values.joinId,
    values.source,
    values.sourceId,
    values.matchedTitle,
    values.matchedAuthor,
    values.ratingAverage,
    values.ratingCount,
    values.pageCount,
    values.status,
    values.error,
    values.enrichedAt,
  );
}

function recordFailure(
  db: DatabaseSync,
  joinId: string,
  source: string,
  error: string,
  enrichedAt: string,
): void {
  const existing = db
    .prepare('SELECT join_id FROM enrichment WHERE join_id = ?')
    .get(joinId);

  if (existing) {
    db.prepare(`
      UPDATE enrichment
      SET source = ?, status = 'failed', error = ?, enriched_at = ?
      WHERE join_id = ?
    `).run(source, error, enrichedAt, joinId);
    return;
  }

  upsertEnrichment(db, {
    joinId,
    source,
    sourceId: null,
    matchedTitle: null,
    matchedAuthor: null,
    ratingAverage: null,
    ratingCount: null,
    pageCount: null,
    status: 'failed',
    error,
    enrichedAt,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function enrichBook(
  db: DatabaseSync,
  adapter: EnrichmentAdapter,
  joinId: string,
  options: EnrichBookOptions = {},
): Promise<EnrichmentOutcome> {
  const book = readBook(db, joinId);
  if (!book) {
    throw new Error(`Book record ${joinId} was not found.`);
  }

  const enrichedAt = (options.now?.() ?? new Date()).toISOString();

  let candidates: EnrichmentCandidate[];
  try {
    candidates = await adapter.search({
      title: book.title,
      author: book.author,
    });
  } catch (error) {
    const detail = errorMessage(error);
    recordFailure(db, joinId, adapter.source, detail, enrichedAt);
    return { status: 'failed', joinId, error: detail };
  }

  const candidate = selectCandidate(candidates, {
    title: book.title,
    author: book.author,
  });

  if (!candidate) {
    db.exec('BEGIN IMMEDIATE');
    try {
      replaceSubjects(db, joinId, []);
      upsertEnrichment(db, {
        joinId,
        source: adapter.source,
        sourceId: null,
        matchedTitle: null,
        matchedAuthor: null,
        ratingAverage: null,
        ratingCount: null,
        pageCount: null,
        status: 'unmatched',
        error: null,
        enrichedAt,
      });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    return { status: 'unmatched', joinId };
  }

  let data: EnrichmentData;
  try {
    data = await adapter.fetch(candidate);
  } catch (error) {
    const detail = errorMessage(error);
    recordFailure(db, joinId, adapter.source, detail, enrichedAt);
    return { status: 'failed', joinId, error: detail };
  }

  const ratingCount =
    data.ratingCount !== null && data.ratingCount > 0 ? data.ratingCount : 0;
  const ratingAverage =
    ratingCount > 0 && data.ratingAverage !== null ? data.ratingAverage : null;

  db.exec('BEGIN IMMEDIATE');
  try {
    replaceSubjects(db, joinId, data.subjects);
    upsertEnrichment(db, {
      joinId,
      source: adapter.source,
      sourceId: candidate.sourceId,
      matchedTitle: candidate.title,
      matchedAuthor: matchedAuthorFor(candidate, book.author),
      ratingAverage,
      ratingCount,
      pageCount: data.pageCount ?? candidate.pageCount,
      status: 'enriched',
      error: null,
      enrichedAt,
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { status: 'enriched', joinId, candidate, data };
}
