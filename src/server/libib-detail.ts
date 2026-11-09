import { decodeHtmlEntities } from './html-entities.js';
import {
  LIBIB_BASE_URL,
  LIBIB_USER_AGENT,
  LibibRequestError,
} from './libib-index.js';

export const DEFAULT_DETAIL_DELAY_MS = 2000;

export interface LibibDetail {
  joinId: string;
  title: string;
  author: string | null;
  publisher: string | null;
  year: number | null;
  description: string | null;
  copies: number;
  out: number;
  holds: number;
  tags: string[];
  statusLabel: string | null;
}

export interface DetailEnvelope {
  outcome?: string;
  'item-info'?: string;
}

export interface FetchDetailOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

function divByClasses(html: string, ...classes: string[]): string | null {
  const lookaheads = classes
    .map((name) => `(?=[^"]*\\b${escapeRegExp(name)}\\b)`)
    .join('');
  const pattern = new RegExp(
    `<div\\b[^>]*class="${lookaheads}[^"]*"[^>]*>([\\s\\S]*?)<\\/div>`,
    'i',
  );
  return pattern.exec(html)?.[1] ?? null;
}

function divByAttribute(
  html: string,
  attribute: string,
  value: string,
): string | null {
  const pattern = new RegExp(
    `<div\\b[^>]*${attribute}="${escapeRegExp(value)}"[^>]*>([\\s\\S]*?)<\\/div>`,
    'i',
  );
  return pattern.exec(html)?.[1] ?? null;
}

function countAfterLabel(html: string, label: string): number {
  const pattern = new RegExp(
    `${label}:\\s*<\\/strong>\\s*(?:<[^>]*>\\s*)*([0-9]+)`,
    'i',
  );
  const match = pattern.exec(html);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function parseTags(html: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const pattern = /<span\b[^>]*>([\s\S]*?)<\/span>/gi;
  for (const match of html.matchAll(pattern)) {
    const tag = cleanText(match[1]);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

export function truncateDetailMarkup(html: string): string {
  const index = html.indexOf('<script');
  return index === -1 ? html : html.slice(0, index);
}

export function parseDetailItemInfo(html: string): LibibDetail | null {
  if (!html) return null;

  const markup = truncateDetailMarkup(html);
  const joinId =
    /class="item-dv details-view"[^>]*data-join-id="(\d+)"/i.exec(markup)?.[1] ??
    /data-join-id="(\d+)"/i.exec(markup)?.[1];
  if (!joinId) return null;

  const titleHtml =
    divByClasses(markup, 'item-title', 'hide-mobile') ??
    divByClasses(markup, 'item-title', 'show-mobile');
  const title = titleHtml ? cleanText(titleHtml) : '';
  if (!title) return null;

  const authorHtml =
    divByClasses(markup, 'item-author', 'hide-mobile') ??
    divByClasses(markup, 'item-author', 'show-mobile');

  let publisher: string | null = null;
  let year: number | null = null;
  const metaPattern = /<span class="meta">([\s\S]*?)<\/span>/gi;
  for (const match of markup.matchAll(metaPattern)) {
    const text = cleanText(match[1]);
    if (year === null && /^\d{4}$/.test(text)) {
      year = Number.parseInt(text, 10);
      continue;
    }
    const published = /^\((.+)\)$/.exec(text);
    if (publisher === null && published) {
      publisher = published[1].trim() || null;
    }
  }

  const tagsHtml = divByClasses(markup, 'item-tags');
  const descriptionHtml = divByAttribute(markup, 'data-tab', 'Description');
  const statusHtml = divByClasses(markup, 'item-status-display');
  const description = descriptionHtml ? cleanText(descriptionHtml) : '';

  return {
    joinId,
    title,
    author: normalizeAuthor(authorHtml ?? ''),
    publisher,
    year,
    description: description || null,
    copies: countAfterLabel(markup, 'Copies'),
    out: countAfterLabel(markup, 'Out'),
    holds: countAfterLabel(markup, 'Holds'),
    tags: tagsHtml ? parseTags(tagsHtml) : [],
    statusLabel: statusHtml ? cleanText(statusHtml) || null : null,
  };
}

export function parseDetailEnvelope(
  envelope: DetailEnvelope,
): LibibDetail | null {
  if (envelope.outcome !== 'success') return null;
  return parseDetailItemInfo(envelope['item-info'] ?? '');
}

function assertOk(response: Response, url: string): void {
  if (response.ok) return;

  if (response.status === 403 || response.status === 429) {
    throw new LibibRequestError(
      response.status,
      `Libib refused the detail request (HTTP ${response.status}). ` +
        'The catalogue may be blocking automated access; wait and try again later.',
    );
  }

  throw new LibibRequestError(
    response.status,
    `Libib detail request failed (HTTP ${response.status}) for ${url}.`,
  );
}

export async function fetchBookDetail(
  joinId: string,
  options: FetchDetailOptions = {},
): Promise<LibibDetail | null> {
  const baseUrl = (options.baseUrl ?? LIBIB_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const userAgent = options.userAgent ?? LIBIB_USER_AGENT;
  const url = `${baseUrl}/item-details-view`;

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/html;q=0.9',
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': userAgent,
    },
    body: new URLSearchParams({ join_id: joinId }).toString(),
  });
  assertOk(response, url);

  return parseDetailEnvelope((await response.json()) as DetailEnvelope);
}
