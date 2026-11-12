import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { openDatabase } from '../src/server/db.js';
import { seedDatabase } from '../src/server/seed.js';
import { StatusPage } from '../src/client/StatusPage.js';
import { TermsPage } from '../src/client/TermsPage.js';
import {
  REPOSITORY_URL,
  SiteFooter,
} from '../src/client/SiteFooter.js';

let app: FastifyInstance;
let dataDir: string;
let clientDir: string;

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'open-house-terms-page-'));
  clientDir = mkdtempSync(path.join(tmpdir(), 'open-house-terms-client-'));
  mkdirSync(clientDir, { recursive: true });
  writeFileSync(
    path.join(clientDir, 'index.html'),
    '<!doctype html><title>terms shell</title><div id="root"></div>',
  );

  const config = loadConfig({ dataDir });
  const db = openDatabase(config);
  seedDatabase(db, { coversDir: config.coversDir });
  db.close();

  app = await buildApp({ dataDir, serveStatic: true, clientDir });
});

afterEach(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(clientDir, { recursive: true, force: true });
});

describe('terms page route', () => {
  it('serves the SPA shell for /terms on direct load', async () => {
    const terms = await app.inject({ method: 'GET', url: '/terms' });
    expect(terms.statusCode).toBe(200);
    expect(terms.body).toContain('terms shell');

    const trailing = await app.inject({ method: 'GET', url: '/terms/' });
    expect(trailing.statusCode).toBe(200);
    expect(trailing.body).toContain('terms shell');

    const books = await app.inject({ method: 'GET', url: '/api/books' });
    expect(books.statusCode).toBe(200);
  });
});

describe('terms page content', () => {
  function renderTerms(): string {
    return renderToStaticMarkup(createElement(TermsPage));
  }

  it('covers the required disclosures', () => {
    const markup = renderTerms();

    expect(markup).toContain('read-only discovery layer');
    expect(markup).toContain('not Libib');
    expect(markup).toContain('Circulation figures and Holds are informational');
    expect(markup).toContain('Borrowing');
    expect(markup).toContain('Libib');
    expect(markup).toContain('Open Library');
    expect(markup).toContain('refreshed timestamps');
    expect(markup).toContain('There are no accounts');
    expect(markup).toContain('no tracking cookies');
    expect(markup).toContain('cookieless, aggregate Site analytics');
    expect(markup).toContain('stores no IP addresses');
    expect(markup).toContain('persistent identifiers');
    expect(markup).toContain('approximate daily');
    expect(markup).toContain('Raw Search text');
    expect(markup).toContain('private report for the Librarian');
    expect(markup).toContain('href="/analytics"');
    expect(markup).toContain('their own terms');
    expect(markup).toContain('best-effort basis with no warranty');
    expect(markup).toContain('not affiliated with Libib or Open Library');
    expect(markup).toContain('contact the Librarian');
    expect(markup).toContain('No licence has been chosen');
    expect(markup).toContain('Last updated');
    expect(markup).toContain('12 November 2026');
  });

  it('opens external links in a new tab safely', () => {
    const markup = renderTerms();
    const externalLinks = markup.match(/<a [^>]*href="https?:\/\/[^"]*"[^>]*>/g);

    expect(externalLinks).not.toBeNull();
    expect(externalLinks?.length).toBeGreaterThan(0);
    for (const link of externalLinks ?? []) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
    }
    expect(markup).toContain(`href="${REPOSITORY_URL}"`);
  });
});

describe('footer links', () => {
  it('links to Terms and the repository with a safe external link', () => {
    const markup = renderToStaticMarkup(
      createElement(SiteFooter, { label: 'Open House Library' }),
    );

    expect(markup).toContain('href="/terms"');
    expect(markup).toContain(`href="${REPOSITORY_URL}"`);
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).toContain('GitHub');
  });

  it('renders the same links on the status page', () => {
    const markup = renderToStaticMarkup(createElement(StatusPage));

    expect(markup).toContain('href="/terms"');
    expect(markup).toContain(`href="${REPOSITORY_URL}"`);
  });
});
