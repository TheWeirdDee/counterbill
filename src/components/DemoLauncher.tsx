'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, type ApiFail } from './ui';

export function DemoLauncher({ slug, primary = true, label = 'Investigate this sample case' }: { slug: string; primary?: boolean; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiFail | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await api<{ url: string }>(`/api/demo/cases/${slug}/run`, { method: 'POST' });
    if (res.ok) router.push(res.data.url);
    else {
      setError(res.error);
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className={`btn ${primary ? 'btn-primary' : ''}`} onClick={run} disabled={busy} aria-describedby={error ? `launch-err-${slug}` : undefined}>
        {busy ? 'Starting a fresh investigation…' : label}
      </button>
      {error ? (
        <div id={`launch-err-${slug}`} role="alert" className="banner banner-bad" style={{ marginTop: 12 }}>
          <strong>{error.code === 'missing_api_key' || error.code === 'unsupported_model' ? 'This deployment is not set up for live investigations.' : 'The investigation could not start.'}</strong>
          <p style={{ margin: '6px 0 0' }}>{error.message}</p>
          {error.retryable && error.code !== 'missing_api_key' ? (
            <button type="button" className="btn btn-sm" onClick={run} style={{ marginTop: 8 }}>
              Try again
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
