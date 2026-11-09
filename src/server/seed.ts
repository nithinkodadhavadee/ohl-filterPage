import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { decodeHtmlEntities, decodeMaybe } from './html-entities.js';

interface SeedEnrichment {
  source: string;
  sourceId?: string | null;
  matchedTitle?: string | null;
  matchedAuthor?: string | null;
  ratingAverage?: number | null;
  ratingCount?: number | null;
  pageCount?: number | null;
  status?: string;
  error?: string | null;
  enrichedAt?: string | null;
}

interface SeedBook {
  joinId: string;
  title: string;
  author?: string | null;
  publisher?: string | null;
  year?: number | null;
  description?: string | null;
  coverPath?: string | null;
  copies?: number;
  out?: number;
  holds?: number;
  firstSeenAt?: string;
  lastRefreshedAt?: string | null;
  tags?: string[];
  subjects?: string[];
  enrichment?: SeedEnrichment | null;
}

interface SeedFile {
  meta?: {
    lastIndexRefreshedAt?: string | null;
  };
  books: SeedBook[];
}

export interface SeedOptions {
  fixturesPath?: string;
  coversSourceDir?: string;
  coversDir?: string;
}

export interface SeedResult {
  books: number;
  tags: number;
  subjects: number;
  enrichments: number;
  coversCopied: number;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(moduleDir, '../..');
const DEFAULT_FIXTURES_PATH = path.join(projectRoot, 'fixtures/seed-books.json');
const DEFAULT_COVERS_SOURCE_DIR = path.join(projectRoot, 'fixtures/covers');

function toText(value: string | null | undefined): string | null {
  const decoded = decodeMaybe(value ?? null)?.trim();
  return decoded ? decoded : null;
}

function toTags(book: SeedBook): string[] {
  return [...new Set((book.tags ?? []).map(decodeHtmlEntities))];
}

function toSubjects(book: SeedBook): string[] {
  return [...new Set((book.subjects ?? []).map(decodeHtmlEntities))];
}

export function seedDatabase(
  db: DatabaseSync,
  options: SeedOptions = {},
): SeedResult {
  const fixturesPath = options.fixturesPath ?? DEFAULT_FIXTURES_PATH;
  const coversSourceDir = options.coversSourceDir ?? DEFAULT_COVERS_SOURCE_DIR;
  const coversDir =
    options.coversDir ?? path.resolve(projectRoot, 'data/covers');

  const fixture = JSON.parse(readFileSync(fixturesPath, 'utf8')) as SeedFile;
  if (!Array.isArray(fixture.books)) {
    throw new Error(`Fixture file ${fixturesPath} has no books array`);
  }

  const upsertBook = db.prepare(`
    INSERT INTO book_records (
      join_id, title, author, publisher, year, description, cover_path,
      copies, out, holds, first_seen_at, last_refreshed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(join_id) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      publisher = excluded.publisher,
      year = excluded.year,
      description = excluded.description,
      cover_path = excluded.cover_path,
      copies = excluded.copies,
      out = excluded.out,
      holds = excluded.holds,
      first_seen_at = excluded.first_seen_at,
      last_refreshed_at = excluded.last_refreshed_at
  `);
  const deleteTags = db.prepare('DELETE FROM book_tags WHERE join_id = ?');
  const insertTag = db.prepare(
    'INSERT INTO book_tags (join_id, tag) VALUES (?, ?)',
  );
  const deleteSubjects = db.prepare(
    'DELETE FROM book_subjects WHERE join_id = ?',
  );
  const insertSubject = db.prepare(
    'INSERT INTO book_subjects (join_id, subject) VALUES (?, ?)',
  );
  const deleteEnrichment = db.prepare('DELETE FROM enrichment WHERE join_id = ?');
  const insertEnrichment = db.prepare(`
    INSERT INTO enrichment (
      join_id, source, source_id, matched_title, matched_author,
      rating_average, rating_count, page_count, status, error, enriched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteFts = db.prepare('DELETE FROM books_fts WHERE join_id = ?');
  const insertFts = db.prepare(`
    INSERT INTO books_fts (join_id, title, author, description)
    VALUES (?, ?, ?, ?)
  `);
  const upsertState = db.prepare(`
    INSERT INTO crawl_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  let tags = 0;
  let subjects = 0;
  let enrichments = 0;
  let coversCopied = 0;

  db.exec('BEGIN');
  try {
    for (const book of fixture.books) {
      const title = decodeHtmlEntities(book.title);
      const author = toText(book.author);
      const publisher = toText(book.publisher);
      const description = toText(book.description);
      const coverPath = book.coverPath ?? null;
      const tagsForBook = toTags(book);
      const subjectsForBook = toSubjects(book);

      upsertBook.run(
        book.joinId,
        title,
        author,
        publisher,
        book.year ?? null,
        description,
        coverPath,
        book.copies ?? 0,
        book.out ?? 0,
        book.holds ?? 0,
        book.firstSeenAt ?? new Date().toISOString(),
        book.lastRefreshedAt ?? null,
      );

      deleteTags.run(book.joinId);
      for (const tag of tagsForBook) {
        insertTag.run(book.joinId, tag);
        tags += 1;
      }

      deleteSubjects.run(book.joinId);
      for (const subject of subjectsForBook) {
        insertSubject.run(book.joinId, subject);
        subjects += 1;
      }

      deleteEnrichment.run(book.joinId);
      if (book.enrichment) {
        const enrichment = book.enrichment;
        insertEnrichment.run(
          book.joinId,
          enrichment.source,
          enrichment.sourceId ?? null,
          toText(enrichment.matchedTitle),
          toText(enrichment.matchedAuthor),
          enrichment.ratingAverage ?? null,
          enrichment.ratingCount ?? null,
          enrichment.pageCount ?? null,
          enrichment.status ?? 'pending',
          enrichment.error ?? null,
          enrichment.enrichedAt ?? null,
        );
        enrichments += 1;
      }

      deleteFts.run(book.joinId);
      insertFts.run(book.joinId, title, author ?? '', description ?? '');

      if (coverPath) {
        const source = path.join(coversSourceDir, coverPath);
        const destination = path.join(coversDir, coverPath);
        if (existsSync(source)) {
          mkdirSync(path.dirname(destination), { recursive: true });
          copyFileSync(source, destination);
          coversCopied += 1;
        }
      }
    }

    if (fixture.meta?.lastIndexRefreshedAt !== undefined) {
      upsertState.run('last_index_refreshed_at', fixture.meta.lastIndexRefreshedAt);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    books: fixture.books.length,
    tags,
    subjects,
    enrichments,
    coversCopied,
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const config = loadConfig();
  const db = openDatabase(config);
  try {
    const result = seedDatabase(db, { coversDir: config.coversDir });
    console.log(
      `Seeded ${result.books} books (${result.tags} tags, ${result.subjects} subjects, ` +
        `${result.enrichments} enrichments, ${result.coversCopied} covers) into ${config.dbPath}`,
    );
  } finally {
    db.close();
  }
}
