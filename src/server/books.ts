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

export function getBooks(
  db: DatabaseSync,
  options: { limit: number; offset: number },
): BooksPage {
  const total =
    row<{ total: number }>(db.prepare('SELECT COUNT(*) AS total FROM book_records'))
      ?.total ?? 0;

  const statement = db.prepare(`
    SELECT * FROM book_records
    ORDER BY title COLLATE NOCASE ASC, join_id ASC
    LIMIT ? OFFSET ?
  `);
  const records = rows<BookRow>(statement, options.limit, options.offset);
  const items = records.map((record) => toBook(db, record));
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
