'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, HamburgerButton, ThemeMenu, Wordmark } from './ui';

const I = (d: string) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ITEMS = [
  { href: '/app', label: 'Cases', icon: I('M4 6h16M4 12h16M4 18h10'), match: (p: string) => p === '/app' || p.startsWith('/app/cases') },
  { href: '/app/new', label: 'New case', icon: I('M12 5v14M5 12h14'), match: (p: string) => p.startsWith('/app/new') },
  { href: '/examples', label: 'Examples', icon: I('M7 3h7l5 5v13H7zM14 3v5h5'), match: (p: string) => p.startsWith('/examples') },
  { href: '/docs', label: 'Documentation', icon: I('M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11'), match: (p: string) => p.startsWith('/docs') },
  { href: '/app/settings', label: 'Settings', icon: I('M4 7h10m4 0h2M4 17h2m4 0h10M14 7a2 2 0 1 0 4 0 2 2 0 0 0-4 0ZM6 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z'), match: (p: string) => p.startsWith('/app/settings') },
];

export function AppShell({ user, children }: { user: { displayName: string; email: string }; children: React.ReactNode }) {
  const path = usePathname() ?? '';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setMenu(false);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }
  const name = user.displayName || user.email;

  return (
    <div className="shell">
      <aside id="app-rail" className={`rail${open ? ' open' : ''}`} aria-label="Application">
        <div className="brand">
          <Wordmark href="/app" />
        </div>
        <nav aria-label="Primary">
          {ITEMS.map((i) => (
            <Link key={i.href} href={i.href} className="item" aria-current={i.match(path) ? 'page' : undefined}>
              {i.icon}
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="grow" />
        <div style={{ padding: '0 2px 8px' }}>
          <ThemeMenu placement="up" showLabel />
        </div>
        <div className="account" ref={accountRef}>
          <button type="button" className="account-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <span className="avatar" aria-hidden="true">
              {name.trim().charAt(0) || '?'}
            </span>
            <span className="who">
              <b>{name}</b>
              {user.displayName ? <span>{user.email}</span> : null}
            </span>
          </button>
          {menu ? (
            <div role="menu" aria-label="Account" className="popover up">
              <Link role="menuitem" href="/app/settings" className="menu-link">
                Account settings
              </Link>
              <Link role="menuitem" href="/docs" className="menu-link">
                Documentation
              </Link>
              <hr />
              <button type="button" role="menuitem" onClick={signOut}>
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </aside>
      <div className={`scrim${open ? ' open' : ''}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <div className="shell-main">
        <div className="topbar">
          <Wordmark href="/app" />
          <HamburgerButton open={open} onClick={() => setOpen((o) => !o)} controls="app-rail" />
        </div>
        <main id="main" className="page">
          {children}
        </main>
      </div>
    </div>
  );
}
