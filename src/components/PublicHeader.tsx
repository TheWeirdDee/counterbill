'use client';

import Link from 'next/link';
import { useState } from 'react';
import { HamburgerButton, ThemeToggle, Wordmark } from './ui';

export function PublicHeader({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container inner">
        <Wordmark />
        <HamburgerButton open={open} onClick={() => setOpen((o) => !o)} controls="public-nav" />
        <nav id="public-nav" aria-label="Main" className={`nav-links${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/demo">See a live case</Link>
          {signedIn ? <Link href="/app">Your cases</Link> : <Link href="/login">Sign in</Link>}
          <ThemeToggle />
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
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container inner" style={{ width: 'min(1180px, 100% - 32px)' }}>
        <Wordmark />
        <HamburgerButton open={open} onClick={() => setOpen((o) => !o)} controls="ws-nav" />
        <nav id="ws-nav" aria-label="Main" className={`nav-links${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
          <Link href="/demo">Sample cases</Link>
          <Link href="/app">Your cases</Link>
          <ThemeToggle />
          <Link href="/app/new" className="btn btn-primary">
            Start a case
          </Link>
        </nav>
      </div>
    </header>
  );
}
