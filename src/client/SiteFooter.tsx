export const REPOSITORY_URL =
  'https://github.com/nithinkodadhavadee/ohl-filterPage';

export function SiteFooter({ label }: { label: string }) {
  return (
    <footer className="site-footer">
      <p className="muted">{label}</p>
      <nav className="footer-links" aria-label="Footer">
        <a href="/">Catalogue</a>
        <a href="/status">System status</a>
        <a href="/terms">Terms</a>
        <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
      </nav>
    </footer>
  );
}
