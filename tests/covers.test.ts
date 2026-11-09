import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheCover, coverFileName } from '../src/server/covers.js';
import type { LibibIndexItem } from '../src/server/libib-index.js';
import { fixturePath } from './fixtures.js';

let coversDir: string;

beforeEach(() => {
  coversDir = mkdtempSync(path.join(tmpdir(), 'open-house-library-covers-'));
});

afterEach(() => {
  rmSync(coversDir, { recursive: true, force: true });
});

function item(overrides: Partial<LibibIndexItem> = {}): LibibIndexItem {
  return {
    joinId: '167806440',
    title: '1984',
    author: 'George Orwell',
    coverUrl: 'https://cdn.example/cover.jpg',
    ...overrides,
  };
}

describe('cacheCover', () => {
  it('downloads a cover once and reuses the existing file', async () => {
    const bytes = readFileSync(fixturePath('libib-cover-1984.jpg'));
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;

    const entry = item();
    const first = await cacheCover(entry, { coversDir, fetchImpl });
    const second = await cacheCover(entry, { coversDir, fetchImpl });

    expect(first).toBe(coverFileName(entry.joinId, entry.coverUrl as string));
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(existsSync(path.join(coversDir, first as string))).toBe(true);
  });

  it('leaves the cover path null when a book has no cover', async () => {
    const result = await cacheCover(item({ coverUrl: null }), {
      coversDir,
      fetchImpl: (async () => {
        throw new Error('should not fetch');
      }) as typeof fetch,
    });

    expect(result).toBeNull();
  });

  it('leaves the cover path null when the CDN rejects the download', async () => {
    const result = await cacheCover(item(), {
      coversDir,
      fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch,
    });

    expect(result).toBeNull();
  });
});
