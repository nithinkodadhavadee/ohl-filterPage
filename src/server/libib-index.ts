import { decodeHtmlEntities } from './html-entities.js';

export const LIBIB_BASE_URL = 'https://www.libib.com/u/openhouselibrary';
export const LIBIB_LIBRARY_ID = '2677037';
export const LIBIB_USER_AGENT =
  'OpenHouseLibraryDiscovery/0.1 (local prototype; read-only catalogue refresh)';
export const DEFAULT_INDEX_DELAY_MS = 1000;

export interface LibibIndexItem {
  joinId: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
}

export interface IndexEnvelope {
  outcome?: string;
  offset?: number | string;
  empty_set_of_items?: boolean;
  'item-count'?: number;
  limit?: number;
  directory?: string;
  'item-info'?: string;
}

export interface ParsedIndexPage {
  items: LibibIndexItem[];
  nextOffset: number | null;
  empty: boolean;
}

export interface FetchIndexOptions {
  baseUrl?: string;
  libraryId?: string;
  fetchImpl?: typeof fetch;
  delayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  userAgent?: string;
}

export class LibibRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'LibibRequestError';
    this.status = status;
  }
}

const CARD_SPLIT = /<div class="item [^"]*"\s+data-join-id="/;

function cleanText(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAuthor(value: string): string | null {
  const author = cleanText(value);
  if (!author) return null;
  if (author.toLowerCase() === 'a/nil') return null;
  return author;
}

function normalizeCoverUrl(value: string | undefined): string | null {
  if (!value) return null;
  const decoded = decodeHtmlEntities(value).trim();
  if (decoded.startsWith('//')) return `https:${decoded}`;
  return /^https?:\/\//i.test(decoded) ? decoded : null;
}

export function parseIndexItemInfo(html: string): LibibIndexItem[] {
  if (!html) return [];

  const items: LibibIndexItem[] = [];
  const cards = html.split(CARD_SPLIT).slice(1);
  for (const card of cards) {
    const idEnd = card.indexOf('"');
    if (idEnd <= 0) continue;

    const joinId = card.slice(0, idEnd).trim();
    if (!/^\d+$/.test(joinId)) continue;

    const body = card.slice(idEnd + 1);
    const titleMatch = /<div class="item-title">([\s\S]*?)<\/div>/.exec(body);
    if (!titleMatch) continue;

    const title = cleanText(titleMatch[1]);
    if (!title) continue;

    const authorMatch = /<div class="item-author">([\s\S]*?)<\/div>/.exec(body);
    const coverMatch = /<img[^>]*\bsrc="([^"]*)"/.exec(body);

    items.push({
      joinId,
      title,
      author: normalizeAuthor(authorMatch?.[1] ?? ''),
      coverUrl: normalizeCoverUrl(coverMatch?.[1]),
    });
  }

  return items;
}

export function parseIndexPage(envelope: IndexEnvelope): ParsedIndexPage {
  const items = parseIndexItemInfo(envelope['item-info'] ?? '');
  const offset = Number(envelope.offset);

  return {
    items,
    nextOffset: Number.isFinite(offset) ? offset : null,
    empty:
      envelope.empty_set_of_items === true ||
      (envelope['item-count'] === 0 && items.length === 0),
  };
}

function cookieFrom(response: Response): string | null {
  const header = response.headers.get('set-cookie');
  if (!header) return null;
  const match = /PHPSESSID=([^;,\s]+)/.exec(header);
  return match ? `PHPSESSID=${match[1]}` : null;
}

function requestHeaders(
  userAgent: string,
  cookie: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/html;q=0.9',
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': userAgent,
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

function assertOk(response: Response, url: string): void {
  if (response.ok) return;

  if (response.status === 403 || response.status === 429) {
    throw new LibibRequestError(
      response.status,
      `Libib refused the catalogue request (HTTP ${response.status}). ` +
        'The catalogue may be blocking automated access; wait and try again later.',
    );
  }

  throw new LibibRequestError(
    response.status,
    `Libib catalogue request failed (HTTP ${response.status}) for ${url}.`,
  );
}

const defaultSleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function fetchCatalogueIndex(
  options: FetchIndexOptions = {},
): Promise<LibibIndexItem[]> {
  const baseUrl = (options.baseUrl ?? LIBIB_BASE_URL).replace(/\/+$/, '');
  const libraryId = options.libraryId ?? LIBIB_LIBRARY_ID;
  const fetchImpl = options.fetchImpl ?? fetch;
  const delayMs = options.delayMs ?? DEFAULT_INDEX_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const userAgent = options.userAgent ?? LIBIB_USER_AGENT;

  let cookie: string | null = null;

  const sortUrl = `${baseUrl}/change-sort-order`;
  const sortResponse = await fetchImpl(sortUrl, {
    method: 'POST',
    headers: requestHeaders(userAgent, cookie),
    body: new URLSearchParams({
      sort: 'title_sort_key',
      library_id: libraryId,
    }).toString(),
  });
  assertOk(sortResponse, sortUrl);
  cookie = cookieFrom(sortResponse) ?? cookie;

  if (delayMs > 0) await sleep(delayMs);

  const items: LibibIndexItem[] = [];
  const itemsUrl = `${baseUrl}/get-account-items`;
  let offset = 0;

  for (;;) {
    const response = await fetchImpl(itemsUrl, {
      method: 'POST',
      headers: requestHeaders(userAgent, cookie),
      body: new URLSearchParams({
        library_id: libraryId,
        offset: String(offset),
        active_letter: 'ALL',
      }).toString(),
    });
    assertOk(response, itemsUrl);
    cookie = cookieFrom(response) ?? cookie;

    const page = parseIndexPage((await response.json()) as IndexEnvelope);
    items.push(...page.items);

    if (page.empty || page.items.length === 0) break;

    if (page.nextOffset === null || page.nextOffset <= offset) {
      throw new LibibRequestError(
        0,
        `Libib catalogue pagination did not advance from offset ${offset}.`,
      );
    }

    offset = page.nextOffset;
    if (delayMs > 0) await sleep(delayMs);
  }

  return items;
}
