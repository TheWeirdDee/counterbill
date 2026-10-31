import Link from 'next/link';
import { BrandMark } from './BrandMark';

const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: 'Product',
    links: [
      { href: '/#product', label: 'What you leave with' },
      { href: '/#how-it-works', label: 'How it works' },
      { href: '/#evidence', label: 'Evidence changes the conclusion' },
      { href: '/#faq', label: 'Questions' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/docs', label: 'Documentation' },
      { href: '/docs#getting-started', label: 'Getting started' },
      { href: '/docs#understanding-discrepancies', label: 'Understanding discrepancies' },
      { href: '/docs#troubleshooting', label: 'Troubleshooting' },
      { href: '/examples', label: 'Example cases' },
    ],
  },
  {
    title: 'Privacy and data',
    links: [
      { href: '/docs#data-and-privacy', label: 'Storage and provider processing' },
      { href: '/docs#deleting-data', label: 'Deleting your data' },
      { href: '/docs#scope', label: 'What Counterbill does not do' },
      { href: '/docs#example-provenance', label: 'Example sources' },
    ],
  },
  {
    title: 'Account',
    links: [
      { href: '/signup', label: 'Create an account' },
      { href: '/login', label: 'Sign in' },
      { href: '/app/new', label: 'Start a case' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Link href="/" className="wordmark" aria-label="Counterbill home">
              <BrandMark />
              Counterbill
            </Link>
            <p>Compare a freight invoice with the records behind it, and prepare a complaint you review yourself.</p>
          </div>
          {GROUPS.map((g) => (
            <nav key={g.title} aria-label={g.title}>
              <h2>{g.title}</h2>
              <ul>
                {g.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="footer-legal">
          <p>Findings support your review; they do not establish liability.</p>
          <p>© {new Date().getFullYear()} Counterbill.</p>
        </div>
      </div>
    </footer>
  );
}
