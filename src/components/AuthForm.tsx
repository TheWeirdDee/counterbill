'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';
import { api, type ApiFail } from './ui';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get('next');
  const id = useId();
  const [error, setError] = useState<ApiFail | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const res = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ email: f.get('email'), password: f.get('password'), displayName: f.get('displayName') ?? '' }) });
    if (res.ok) {
      router.push(next && next.startsWith('/') && !next.startsWith('//') ? next : '/app');
      router.refresh();
    } else {
      setError(res.error);
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 40 }}>
      <h1 style={{ fontSize: '1.8rem' }}>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
      <p className="muted">{mode === 'login' ? 'Your cases and documents are private to your account.' : 'Accounts keep your cases and uploaded documents private to you.'}</p>
      <form onSubmit={submit} className="card" noValidate>
        {mode === 'signup' ? (
          <div className="field">
            <label htmlFor={`${id}-name`}>Your name</label>
            <input id={`${id}-name`} name="displayName" type="text" autoComplete="name" />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} name="email" type="email" required autoComplete="email" aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-pw`}>Password</label>
          <input id={`${id}-pw`} name="password" type="password" required minLength={8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} aria-describedby={`${id}-hint`} />
          {mode === 'signup' ? (
            <span className="hint" id={`${id}-hint`}>
              At least 8 characters.
            </span>
          ) : null}
        </div>
        {error ? (
          <p role="alert" id={`${id}-err`} className="error-text">
            {error.message}
          </p>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        {mode === 'login' ? (
          <>
            New here? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link> or <Link href="/examples">explore an example case without one</Link>.
          </>
        ) : (
          <>
            Already have an account? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link>.
          </>
        )}
      </p>
    </div>
  );
}
