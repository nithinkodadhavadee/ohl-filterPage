import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

export interface Rating {
  average: number;
  count: number;
  lowSample: boolean;
}

export interface Book {
  joinId: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  publisher: string | null;
  year: number | null;
  description: string | null;
  copies: number;
  out: number;
  holds: number;
  onShelf: number;
  available: boolean;
  tags: string[];
  subjects: string[];
  rating: Rating | null;
  pageCount: number | null;
  refreshedAt: string | null;
  libibUrl: string;
}

export interface BooksPage {
  items: Book[];
  total: number;
  nextOffset: number | null;
  meta: {
    lastIndexRefreshedAt: string | null;
  };
}

export type BookSortField =
  | 'relevance'
  | 'title'
  | 'author'
  | 'holds'
  | 'year'
  | 'rating'
  | 'pageCount'
  | 'random';

export type SortDirection = 'asc' | 'desc';

export const HOLD_BUCKETS = ['0', '1-2', '3-5', '6+'] as const;

export type HoldBucket = (typeof HOLD_BUCKETS)[number];

export function isHoldBucket(value: string): value is HoldBucket {
  return (HOLD_BUCKETS as readonly string[]).includes(value);
}

export interface BooksQuery {
  limit: number;
  offset: number;
  q?: string;
  sort?: BookSortField;
  direction?: SortDirection;
  seed?: string;
  author?: string;
  tags?: string[];
  subjects?: string[];
  holds?: HoldBucket[];
  availableOnly?: boolean;
  ratingMin?: number;
  includeLowSample?: boolean;
  pagesMin?: number;
  pagesMax?: number;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface FacetsResponse {
  tags: FacetCount[];
  authors: FacetCount[];
  subjects: FacetCount[];
}

interface BookRow {
  join_id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  description: string | null;
  cover_path: string | null;
  copies: number;
  out: number;
  holds: number;
  first_seen_at: string;
  last_refreshed_at: string | null;
}

interface EnrichmentRow {
  join_id: string;
  source: string;
  source_id: string | null;
  matched_title: string | null;
  matched_author: string | null;
  rating_average: number | null;
  rating_count: number | null;
  page_count: number | null;
  status: string;
  error: string | null;
  enriched_at: string | null;
}

const LIBIB_BASE_URL = 'https://www.libib.com/u/openhouselibrary';

type Statement = ReturnType<DatabaseSync['prepare']>;

function rows<T>(statement: Statement, ...params: SQLInputValue[]): T[] {
  return statement.all(...params) as unknown as T[];
}

function row<T>(
  statement: Statement,
  ...params: SQLInputValue[]
): T | undefined {
  return statement.get(...params) as unknown as T | undefined;
}

function coverUrlFor(coverPath: string | null): string | null {
  if (!coverPath) return null;
  const encoded = coverPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/covers/${encoded}`;
}

function ratingFor(enrichment: EnrichmentRow | undefined): Rating | null {
  if (
    !enrichment ||
    enrichment.rating_average === null ||
    enrichment.rating_count === null ||
    enrichment.rating_count <= 0
  ) {
    return null;
  }

  return {
    average: enrichment.rating_average,
    count: enrichment.rating_count,
    lowSample: enrichment.rating_count < 5,
  };
}

function getTags(db: DatabaseSync, joinId: string): string[] {
  const statement = db.prepare(
    'SELECT tag FROM book_tags WHERE join_id = ? ORDER BY tag COLLATE NOCASE',
  );
  return rows<{ tag: string }>(statement, joinId).map((entry) => entry.tag);
}

function getSubjects(db: DatabaseSync, joinId: string): string[] {
  const statement = db.prepare(
    'SELECT subject FROM book_subjects WHERE join_id = ? ORDER BY subject COLLATE NOCASE',
  );
  return rows<{ subject: string }>(statement, joinId).map(
    (entry) => entry.subject,
  );
}

function getEnrichment(db: DatabaseSync, joinId: string): EnrichmentRow | undefined {
  const statement = db.prepare('SELECT * FROM enrichment WHERE join_id = ?');
  return row<EnrichmentRow>(statement, joinId);
}

function holdBucketFor(holds: number): HoldBucket {
  if (holds <= 0) return '0';
  if (holds <= 2) return '1-2';
  if (holds <= 5) return '3-5';
  return '6+';
}

function joinIdsMatching(
  db: DatabaseSync,
  table: 'book_tags' | 'book_subjects',
  column: 'tag' | 'subject',
  values: string[],
): Set<string> {
  const wanted = new Set(values.map((value) => value.toLowerCase()));
  const statement = db.prepare(`SELECT join_id, ${column} AS value FROM ${table}`);
  const matches = new Set<string>();
  for (const entry of rows<{ join_id: string; value: string }>(statement)) {
    if (wanted.has(entry.value.toLowerCase())) matches.add(entry.join_id);
  }
  return matches;
}

function getEnrichmentMap(db: DatabaseSync): Map<string, EnrichmentRow> {
  const statement = db.prepare('SELECT * FROM enrichment');
  const map = new Map<string, EnrichmentRow>();
  for (const entry of rows<EnrichmentRow>(statement)) {
    map.set(entry.join_id, entry);
  }
  return map;
}

function toBook(db: DatabaseSync, record: BookRow): Book {
  const enrichment = getEnrichment(db, record.join_id);
  const onShelf = Math.max(0, record.copies - record.out);

  return {
    joinId: record.join_id,
    title: record.title,
    author: record.author,
    coverUrl: coverUrlFor(record.cover_path),
    publisher: record.publisher,
    year: record.year,
    description: record.description,
    copies: record.copies,
    out: record.out,
    holds: record.holds,
    onShelf,
    available: onShelf > record.holds,
    tags: getTags(db, record.join_id),
    subjects: getSubjects(db, record.join_id),
    rating: ratingFor(enrichment),
    pageCount: enrichment?.page_count ?? null,
    refreshedAt: record.last_refreshed_at,
    libibUrl: `${LIBIB_BASE_URL}?id=${encodeURIComponent(record.join_id)}`,
  };
}

export function getLastIndexRefreshedAt(db: DatabaseSync): string | null {
  const statement = db.prepare(
    "SELECT value FROM crawl_state WHERE key = 'last_index_refreshed_at'",
  );
  return row<{ value: string | null }>(statement)?.value ?? null;
}

interface SearchFields {
  text: string;
  tokens: string[];
}

interface SearchableBook {
  title: SearchFields;
  author: SearchFields;
  description: SearchFields;
}

type MatchKind = 'exact' | 'prefix' | 'substring' | 'fuzzy';

interface TermMatch {
  score: number;
  kind: MatchKind;
}

const SORT_FIELDS = new Set<BookSortField>([
  'relevance',
  'title',
  'author',
  'holds',
  'year',
  'rating',
  'pageCount',
  'random',
]);

const FIELD_WEIGHTS = {
  title: 3,
  author: 2,
  description: 1,
} as const;

function normalizeForSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function tokenize(value: string): string[] {
  return normalizeForSearch(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function searchFieldsFor(value: string | null): SearchFields {
  const text = value ? normalizeForSearch(value) : '';
  return { text, tokens: text.split(/[^a-z0-9]+/).filter(Boolean) };
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function fuzzyThreshold(length: number): number {
  if (length < 4) return 0;
  if (length <= 6) return 1;
  if (length <= 10) return 2;
  return 3;
}

function scoreTerm(term: string, book: SearchableBook): TermMatch | null {
  let best: TermMatch | null = null;

  const consider = (kind: MatchKind, weight: number, distance = 0): void => {
    const base =
      kind === 'exact'
        ? 100
        : kind === 'prefix'
          ? 70
          : kind === 'substring'
            ? 50
            : 40 - distance * 10;
    const score = base * weight;
    if (!best || score > best.score) {
      best = { score, kind };
    }
  };

  const fields: Array<[SearchFields, number]> = [
    [book.title, FIELD_WEIGHTS.title],
    [book.author, FIELD_WEIGHTS.author],
    [book.description, FIELD_WEIGHTS.description],
  ];

  for (const [field, weight] of fields) {
    if (!field.text) continue;

    if (field.tokens.includes(term)) {
      consider('exact', weight);
      continue;
    }

    if (field.tokens.some((token) => token.startsWith(term))) {
      consider('prefix', weight);
      continue;
    }

    if (field.text.includes(term)) {
      consider('substring', weight);
      continue;
    }

    const threshold = fuzzyThreshold(term.length);
    if (threshold > 0) {
      let closest = Number.POSITIVE_INFINITY;
      for (const token of field.tokens) {
        if (Math.abs(token.length - term.length) > threshold) continue;
        const distance = editDistance(term, token);
        if (distance < closest) closest = distance;
      }
      if (closest > 0 && closest <= threshold) {
        consider('fuzzy', weight, closest);
      }
    }
  }

  return best;
}

function ftsMatchesByTerm(
  db: DatabaseSync,
  terms: string[],
): Map<string, Set<string> | null> {
  const matches = new Map<string, Set<string> | null>();
  const statement = db.prepare(
    'SELECT join_id FROM books_fts WHERE books_fts MATCH ?',
  );

  for (const term of terms) {
    if (term.length < 3) continue;
    const expression = `"${term.replace(/"/g, '""')}"`;
    try {
      const ids = new Set(
        rows<{ join_id: string }>(statement, expression).map(
          (entry) => entry.join_id,
        ),
      );
      matches.set(term, ids);
    } catch {
      matches.set(term, null);
    }
  }

  return matches;
}

function scoreRecord(
  record: BookRow,
  terms: string[],
  ftsByTerm: Map<string, Set<string> | null>,
): number | null {
  const book: SearchableBook = {
    title: searchFieldsFor(record.title),
    author: searchFieldsFor(record.author),
    description: searchFieldsFor(record.description),
  };

  let total = 0;
  for (const term of terms) {
    const match = scoreTerm(term, book);
    const ftsSet = ftsByTerm.get(term);
    const ftsHit =
      ftsSet === undefined || ftsSet === null || ftsSet.has(record.join_id);

    if (term.length >= 3) {
      if (!ftsHit && match?.kind !== 'fuzzy') return null;
    } else if (!match) {
      return null;
    }

    total += match ? match.score : 1;
  }

  return total;
}

function compareText(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareTitle(a: BookRow, b: BookRow): number {
  const byTitle = compareText(a.title, b.title);
  return byTitle !== 0 ? byTitle : compareText(a.join_id, b.join_id);
}

function seededHash(seed: string, value: string): number {
  const input = `${seed}:${value}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sortValue(
  record: BookRow,
  field: BookSortField,
  enrichmentByJoinId: Map<string, EnrichmentRow>,
): string | number | null {
  switch (field) {
    case 'title':
      return record.title;
    case 'author':
      return record.author;
    case 'holds':
      return record.holds;
    case 'year':
      return record.year;
    case 'rating':
      return ratingFor(enrichmentByJoinId.get(record.join_id))?.average ?? null;
    case 'pageCount':
      return enrichmentByJoinId.get(record.join_id)?.page_count ?? null;
    default:
      return null;
  }
}

function compareRecords(
  a: BookRow,
  b: BookRow,
  sort: BookSortField,
  direction: SortDirection,
  relevance: Map<string, number> | null,
  seed: string,
  enrichmentByJoinId: Map<string, EnrichmentRow>,
): number {
  if (sort === 'relevance') {
    const left = relevance?.get(a.join_id) ?? 0;
    const right = relevance?.get(b.join_id) ?? 0;
    const byScore = left < right ? -1 : left > right ? 1 : 0;
    if (byScore !== 0) return direction === 'desc' ? -byScore : byScore;
    return compareTitle(a, b);
  }

  if (sort === 'random') {
    const left = seededHash(seed, a.join_id);
    const right = seededHash(seed, b.join_id);
    const byHash = left < right ? -1 : left > right ? 1 : 0;
    if (byHash !== 0) return direction === 'desc' ? -byHash : byHash;
    return compareTitle(a, b);
  }

  const left = sortValue(a, sort, enrichmentByJoinId);
  const right = sortValue(b, sort, enrichmentByJoinId);

  if (left === null && right !== null) return 1;
  if (right === null && left !== null) return -1;

  if (left !== null && right !== null) {
    const byValue =
      typeof left === 'number' && typeof right === 'number'
        ? left < right
          ? -1
          : left > right
            ? 1
            : 0
        : compareText(String(left), String(right));
    if (byValue !== 0) return direction === 'desc' ? -byValue : byValue;
  }

  return compareTitle(a, b);
}

function resolveSort(
  sort: BookSortField | undefined,
  hasSearch: boolean,
): BookSortField {
  if (sort && SORT_FIELDS.has(sort)) {
    if (sort === 'relevance' && !hasSearch) return 'title';
    return sort;
  }
  return hasSearch ? 'relevance' : 'title';
}

function resolveDirection(
  direction: SortDirection | undefined,
  sort: BookSortField,
): SortDirection {
  if (direction === 'asc' || direction === 'desc') return direction;
  return sort === 'relevance' ? 'desc' : 'asc';
}

export function getBooks(db: DatabaseSync, options: BooksQuery): BooksPage {
  const queryText = options.q?.trim() ?? '';
  const terms = tokenize(queryText);
  const hasSearch = terms.length > 0;

  const authorFilter = options.author?.trim().toLowerCase() ?? '';
  const tagFilter = (options.tags ?? []).filter(Boolean);
  const subjectFilter = (options.subjects ?? []).filter(Boolean);
  const holdFilter = options.holds ?? [];
  const onlyAvailable = options.availableOnly === true;
  const ratingMin = options.ratingMin;
  const includeLowSample = options.includeLowSample === true;
  const pagesMin = options.pagesMin ?? null;
  const pagesMax = options.pagesMax ?? null;
  const enrichmentByJoinId = getEnrichmentMap(db);
  const selectedTagIds =
    tagFilter.length > 0
      ? joinIdsMatching(db, 'book_tags', 'tag', tagFilter)
      : null;
  const selectedSubjectIds =
    subjectFilter.length > 0
      ? joinIdsMatching(db, 'book_subjects', 'subject', subjectFilter)
      : null;

  const allRecords = rows<BookRow>(db.prepare('SELECT * FROM book_records')).filter(
    (record) => {
      if (
        authorFilter &&
        !record.author?.toLowerCase().includes(authorFilter)
      ) {
        return false;
      }
      if (
        holdFilter.length > 0 &&
        !holdFilter.includes(holdBucketFor(record.holds))
      ) {
        return false;
      }
      if (
        onlyAvailable &&
        !(Math.max(0, record.copies - record.out) > record.holds)
      ) {
        return false;
      }
      if (selectedTagIds && !selectedTagIds.has(record.join_id)) return false;
      if (selectedSubjectIds && !selectedSubjectIds.has(record.join_id)) {
        return false;
      }

      if (ratingMin !== undefined) {
        const rating = ratingFor(enrichmentByJoinId.get(record.join_id));
        if (!rating) return false;
        if (!includeLowSample && rating.count < 5) return false;
        if (rating.average < ratingMin) return false;
      }

      if (pagesMin !== null || pagesMax !== null) {
        const pageCount =
          enrichmentByJoinId.get(record.join_id)?.page_count ?? null;
        if (pageCount === null) return false;
        if (pagesMin !== null && pageCount < pagesMin) return false;
        if (pagesMax !== null && pageCount > pagesMax) return false;
      }

      return true;
    },
  );

  let records = allRecords;
  let relevance: Map<string, number> | null = null;

  if (hasSearch) {
    const ftsByTerm = ftsMatchesByTerm(db, terms);
    relevance = new Map<string, number>();
    records = [];

    for (const record of allRecords) {
      const score = scoreRecord(record, terms, ftsByTerm);
      if (score !== null) {
        relevance.set(record.join_id, score);
        records.push(record);
      }
    }
  }

  const sort = resolveSort(options.sort, hasSearch);
  const direction = resolveDirection(options.direction, sort);
  const seed = options.seed ?? '';

  records.sort((a, b) =>
    compareRecords(a, b, sort, direction, relevance, seed, enrichmentByJoinId),
  );

  const total = records.length;
  const page = records.slice(options.offset, options.offset + options.limit);
  const items = page.map((record) => toBook(db, record));
  const consumed = options.offset + items.length;

  return {
    items,
    total,
    nextOffset: consumed < total ? consumed : null,
    meta: {
      lastIndexRefreshedAt: getLastIndexRefreshedAt(db),
    },
  };
}

export function getBook(db: DatabaseSync, joinId: string): Book | null {
  const statement = db.prepare('SELECT * FROM book_records WHERE join_id = ?');
  const record = row<BookRow>(statement, joinId);
  return record ? toBook(db, record) : null;
}

export function getFacets(db: DatabaseSync): FacetsResponse {
  const tags = rows<FacetCount>(
    db.prepare(`
      SELECT tag AS value, COUNT(DISTINCT join_id) AS count
      FROM book_tags
      GROUP BY tag
      ORDER BY tag COLLATE NOCASE
    `),
  );
  const authors = rows<FacetCount>(
    db.prepare(`
      SELECT author AS value, COUNT(*) AS count
      FROM book_records
      WHERE author IS NOT NULL AND TRIM(author) <> ''
      GROUP BY author
      ORDER BY author COLLATE NOCASE
    `),
  );
  const subjects = rows<FacetCount>(
    db.prepare(`
      SELECT subject AS value, COUNT(DISTINCT join_id) AS count
      FROM book_subjects
      GROUP BY subject
      ORDER BY subject COLLATE NOCASE
    `),
  );

  return { tags, authors, subjects };
}
