'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { HamburgerButton, ThemeMenu, Wordmark } from './ui';

/** Closes the mobile menu on Escape and whenever the route changes; locks page scroll while it is open. */
function useMobileMenu() {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  // links to a section of the page you are already on change only the hash, not the pathname
  const closeOnLink = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a')) setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    if (window.matchMedia('(max-width: 900px)').matches) document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);
  return [open, setOpen, closeOnLink] as const;
}

export function PublicHeader({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen, closeOnLink] = useMobileMenu();
  const path = usePathname() ?? '';
  const cur = (p: string) => (path === p || path.startsWith(p + '/') ? ('page' as const) : undefined);
  return (
    <header className="site-header">
      <div className="container inner">
        <Wordmark />
        <HamburgerButton open={open} onClick={() => setOpen((o) => !o)} controls="public-nav" />
        <nav id="public-nav" aria-label="Main" className={`nav-links${open ? ' open' : ''}`} onClick={closeOnLink}>
          <Link href="/#product">Product</Link>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/examples" aria-current={cur('/examples')}>
            Examples
          </Link>
          <Link href="/docs" aria-current={cur('/docs')}>
            Docs
          </Link>
          <Link href="/#faq">FAQ</Link>
          {signedIn ? (
            <Link href="/app">Your cases</Link>
          ) : (
            <Link href="/login" aria-current={cur('/login')}>
              Sign in
            </Link>
          )}
          <span className="spacer" />
          <ThemeMenu />
          <Link href="/app/new" className="btn btn-primary">
            Start a case
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** Slim header for the investigation workspace: no marketing footer, same navigation vocabulary. */
export function WorkspaceHeader() {
  const [open, setOpen, closeOnLink] = useMobileMenu();
  return (
    <header className="site-header">
      <div className="container inner" style={{ width: 'min(1240px, 100% - 40px)' }}>
        <Wordmark />
        <HamburgerButton open={open} onClick={() => setOpen((o) => !o)} controls="ws-nav" />
        <nav id="ws-nav" aria-label="Main" className={`nav-links${open ? ' open' : ''}`} onClick={closeOnLink}>
          <Link href="/examples">Examples</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/app">Your cases</Link>
          <span className="spacer" />
          <ThemeMenu />
          <Link href="/app/new" className="btn btn-primary">
            Start a case
          </Link>
        </nav>
      </div>
    </header>
  );
}
