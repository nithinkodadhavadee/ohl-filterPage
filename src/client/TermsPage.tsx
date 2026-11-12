import { useEffect } from 'react';
import { REPOSITORY_URL, SiteFooter } from './SiteFooter';

export const TERMS_LAST_UPDATED = '12 November 2026';

export function TermsPage() {
  useEffect(() => {
    document.title = 'Open House Library — Terms';
  }, []);

  return (
    <div className="page terms-page">
      <header className="site-header">
        <div>
          <p className="eyebrow">Open House Library</p>
          <h1>Terms of use</h1>
          <p className="refresh-note">
            Plain-language terms for this discovery site. Last updated{' '}
            <time dateTime="2026-11-12">{TERMS_LAST_UPDATED}</time>.
          </p>
        </div>
        <a className="back-link" href="/">
          ← Back to catalogue
        </a>
      </header>

      <main className="terms-content">
        <section aria-labelledby="terms-what">
          <h2 id="terms-what">What this site is</h2>
          <p>
            This is a read-only discovery layer for the Open House Library
            catalogue. It is not Libib and it is not the library's system of
            record. The library catalogue itself lives on{' '}
            <a
              href="https://www.libib.com/u/openhouselibrary"
              target="_blank"
              rel="noopener noreferrer"
            >
              Libib
            </a>
            .
          </p>
          <p>
            Circulation figures and Holds are informational only. Borrowing,
            returns and Holds are handled in Libib, not on this site.
          </p>
        </section>

        <section aria-labelledby="terms-data">
          <h2 id="terms-data">Where the data comes from</h2>
          <p>
            Book data comes from Libib and{' '}
            <a
              href="https://openlibrary.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open Library
            </a>
            . It may be delayed or incomplete. The refreshed timestamps shown on
            the catalogue and detail views say when each part of the data was
            last updated.
          </p>
        </section>

        <section aria-labelledby="terms-accounts">
          <h2 id="terms-accounts">Accounts and cookies</h2>
          <p>
            There are no accounts, and you do not need to sign in. The app sets
            no tracking cookies.
          </p>
        </section>

        <section aria-labelledby="terms-analytics">
          <h2 id="terms-analytics">Site analytics</h2>
          <p>
            This site collects cookieless, aggregate Site analytics. The
            collection uses no cookies, stores no IP addresses and keeps no
            persistent identifiers. Unique visitors are an approximate daily
            count, not a record of individuals. Raw Search text is only
            available in a private report for the Librarian; the public{' '}
            <a href="/analytics">analytics page</a> shows aggregates only.
          </p>
        </section>

        <section aria-labelledby="terms-external">
          <h2 id="terms-external">External sites</h2>
          <p>
            Links to Libib, Open Library and other external sites are provided
            for convenience. Those sites have their own terms and privacy
            policies, and this site is not responsible for them.
          </p>
        </section>

        <section aria-labelledby="terms-warranty">
          <h2 id="terms-warranty">Best-effort service</h2>
          <p>
            This site is provided on a best-effort basis with no warranty. It
            may be unavailable, incomplete or out of date. It is not affiliated
            with Libib or Open Library.
          </p>
        </section>

        <section aria-labelledby="terms-corrections">
          <h2 id="terms-corrections">Corrections and contact</h2>
          <p>
            To report a correction or ask about an item, contact the Librarian
            directly. For problems with this website, open an issue on the{' '}
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              project repository
            </a>
            .
          </p>
        </section>

        <section aria-labelledby="terms-licence">
          <h2 id="terms-licence">Licence</h2>
          <p>
            No licence has been chosen for this site yet. Nothing here grants
            permission to reuse, republish or redistribute the catalogue data or
            the site's material.
          </p>
        </section>
      </main>

      <SiteFooter label="Open House Library" />
    </div>
  );
}
