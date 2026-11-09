import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LIBIB_USER_AGENT, type LibibIndexItem } from './libib-index.js';

export interface CacheCoverOptions {
  coversDir: string;
  fetchImpl?: typeof fetch;
}

function extensionFor(coverUrl: string): string {
  try {
    const extension = path.extname(new URL(coverUrl).pathname).toLowerCase();
    return /^\.[a-z0-9]{1,5}$/.test(extension) ? extension : '.jpg';
  } catch {
    return '.jpg';
  }
}

export function coverFileName(joinId: string, coverUrl: string): string {
  const hash = createHash('sha256').update(coverUrl).digest('hex').slice(0, 16);
  return `${joinId}-${hash}${extensionFor(coverUrl)}`;
}

export async function cacheCover(
  item: LibibIndexItem,
  options: CacheCoverOptions,
): Promise<string | null> {
  if (!item.coverUrl) return null;

  const fileName = coverFileName(item.joinId, item.coverUrl);
  const destination = path.join(options.coversDir, fileName);
  if (existsSync(destination)) return fileName;

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(item.coverUrl, {
    headers: { 'user-agent': LIBIB_USER_AGENT },
  });
  if (!response.ok) return null;

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) return null;

  mkdirSync(options.coversDir, { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, destination);

  return fileName;
}
