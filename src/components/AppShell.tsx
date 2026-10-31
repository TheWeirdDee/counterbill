'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, HamburgerButton, ThemeToggle, Wordmark } from './ui';

const ITEMS = [
  { href: '/app', label: 'Dashboard', match: (p: string) => p === '/app' },
  { href: '/app/new', label: 'New case', match: (p: string) => p.startsWith('/app/new') },
  { href: '/demo', label: 'Sample cases', match: (p: string) => p.startsWith('/demo') },
  { href: '/app/settings', label: 'Settings', match: (p: string) => p.startsWith('/app/settings') },
];

export function AppShell({ user, children }: { user: { displayName: string; email: string }; children: React.ReactNode }) {
  const path = usePathname() ?? '';
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await api('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  const links = (
    <>
      {ITEMS.map((i) => (
        <Link key={i.href} href={i.href} className="item" aria-current={i.match(path) ? 'page' : undefined} onClick={() => setOpen(false)}>
          {i.label}
        </Link>
      ))}
    </>
  );

  return (
    <div className="shell">
      <aside className="rail" aria-label="Application">
        <div style={{ padding: '4px 8px 16px' }}>
          <Wordmark href="/app" />
        </div>
        <nav aria-label="Primary" style={{ display: 'grid', gap: 2 }}>
          {links}
        </nav>
        <div className="grow" />
        <ThemeToggle />
        <div style={{ padding: '12px 8px 0', fontSize: '0.84rem' }}>
          <div style={{ fontWeight: 700 }}>{user.displayName || user.email}</div>
          <div className="muted" style={{ overflowWrap: 'anywhere' }}>
            {user.email}
          </div>
          <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="shell-main">
        <div className="topbar">
          <Wordmark href="/app" />
          <HamburgerButton open={open} onClick={() => setOpen((o) => !o)} controls="mobile-nav" />
        </div>
        <nav id="mobile-nav" aria-label="Primary" className={`mobile-nav${open ? ' open' : ''}`}>
          {links}
          <div style={{ padding: '8px 0' }}>
            <ThemeToggle />
          </div>
          <button type="button" className="btn btn-sm" onClick={signOut}>
            Sign out
          </button>
        </nav>
        <main id="main" className="page">
          {children}
        </main>
      </div>
    </div>
  );
}
