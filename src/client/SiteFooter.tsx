import type { Ref } from 'react';
import { trackOutbound } from './analytics';

export const REPOSITORY_URL =
  'https://github.com/nithinkodadhavadee/ohl-filterPage';

export function SiteFooter({
  label,
  ref,
}: {
  label: string;
  ref?: Ref<HTMLElement>;
}) {
  return (
    <footer ref={ref} className="site-footer">
      <p className="muted">{label}</p>
      <nav className="footer-links" aria-label="Footer">
        <a href="/">Catalogue</a>
        <a href="/status">System status</a>
        <a href="/analytics">Analytics</a>
        <a href="/terms" onClick={() => trackOutbound('terms')}>
          Terms
        </a>
        <a
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => trackOutbound('github')}
        >
          GitHub
        </a>
      </nav>
    </footer>
  );
}
