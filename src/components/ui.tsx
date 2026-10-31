'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="wordmark" aria-label="Counterbill home">
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#1b5c88" />
        <path d="M40 22.5c-2.2-2.6-5.4-4-9-4-7.2 0-12.5 5.4-12.5 12.5S23.8 43.5 31 43.5c3.6 0 6.8-1.4 9-4" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
        <path d="M14 51.5h36" stroke="#f3c969" strokeWidth="3.5" strokeLinecap="round" />
      </svg>
      Counterbill
    </Link>
  );
}

export function HamburgerButton({ open, onClick, controls }: { open: boolean; onClick: () => void; controls: string }) {
  return (
    <button type="button" className="btn btn-icon nav-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls={controls} onClick={onClick}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
      </svg>
    </button>
  );
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');
  useEffect(() => {
    try {
      const t = localStorage.getItem('cb-theme');
      if (t === 'light' || t === 'dark') setTheme(t);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const apply = (t: 'system' | 'light' | 'dark') => {
    setTheme(t);
    try {
      if (t === 'system') {
        localStorage.removeItem('cb-theme');
        document.documentElement.removeAttribute('data-theme');
      } else {
        localStorage.setItem('cb-theme', t);
        document.documentElement.setAttribute('data-theme', t);
      }
    } catch {
      /* storage unavailable: applies for this page view only */
      if (t !== 'system') document.documentElement.setAttribute('data-theme', t);
    }
  };
  return (
    <div className="theme-toggle" role="group" aria-label="Colour theme">
      {(['system', 'light', 'dark'] as const).map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => apply(t)}>
          {t[0].toUpperCase() + t.slice(1)}
        </button>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  supported: 'chip-good',
  provisional: 'chip-info',
  disputed: 'chip-warn',
  unresolved: 'chip-warn',
  superseded: 'chip-plain',
  ready: 'chip-good',
  review_ready: 'chip-good',
  completed: 'chip-good',
  finished: 'chip-good',
  processing: 'chip-info',
  investigating: 'chip-info',
  revising: 'chip-info',
  queued: 'chip-info',
  parsing: 'chip-info',
  uploaded: 'chip-plain',
  needs_input: 'chip-warn',
  needs_manual_review: 'chip-warn',
  failed: 'chip-bad',
  draft: 'chip-plain',
  idle: 'chip-plain',
  archived: 'chip-plain',
  material: 'chip-warn',
  needs_review: 'chip-info',
  informational: 'chip-plain',
};

export const STATUS_LABEL: Record<string, string> = {
  review_ready: 'Ready to review',
  needs_input: 'Needs evidence',
  processing: 'Investigating',
  needs_manual_review: 'Needs manual review',
  needs_review: 'Needs review',
  completed: 'Completed',
};

export function StatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={`chip ${STATUS_TONE[status] ?? ''}`}>{label ?? STATUS_LABEL[status] ?? status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</span>;
}

export function SourceChip({ refId, onOpen, title }: { refId: string; onOpen?: (ref: string) => void; title?: string }) {
  if (!onOpen) return <span className="source-chip static" title={title}>{refId}</span>;
  return (
    <button type="button" className="source-chip" onClick={() => onOpen(refId)} title={title ?? `Open source ${refId}`} aria-label={`Open source ${refId}`}>
      {refId}
    </button>
  );
}

export function ReconBadge({ children = 'Reconstructed for demonstration' }: { children?: React.ReactNode }) {
  return <span className="badge-recon">{children}</span>;
}

/** Accessible modal built on the native <dialog>: focus trap, Esc to close, restores focus. */
export function Dialog({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={wide ? 'wide' : undefined} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      <div className="dialog-head">
        <h2 id={titleId} style={{ margin: 0, fontSize: '1.1rem' }}>
          {title}
        </h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close dialog">
          Close
        </button>
      </div>
      <div className="dialog-body">{open ? children : null}</div>
      {footer ? <div className="dialog-foot">{footer}</div> : null}
    </dialog>
  );
}

export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}
export function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export interface ApiFail {
  code: string;
  message: string;
  retryable?: boolean;
}

/** Fetch JSON, returning typed errors instead of throwing for HTTP failures. */
export async function api<T = unknown>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: ApiFail }> {
  try {
    const res = await fetch(url, { ...init, headers: init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: body?.code ? body : { code: 'http_error', message: `Request failed (${res.status}).`, retryable: res.status >= 500 } };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: { code: 'offline', message: 'You appear to be offline. Check your connection and retry.', retryable: true } };
  }
}
