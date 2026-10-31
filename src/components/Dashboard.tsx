'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, fmtDateTime, Skeleton, StatusChip, type ApiFail } from './ui';

interface Row {
  id: string;
  name: string;
  origin: string;
  destination: string;
  claimant: string;
  counterparty: string;
  status: string;
  archived: boolean;
  updatedAt: string;
  differenceDisplay: string | null;
  openQuestions: number;
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'processing', label: 'Investigating' },
  { id: 'needs_input', label: 'Needs input' },
  { id: 'review_ready', label: 'Review ready' },
  { id: 'archived', label: 'Archived' },
] as const;

export function Dashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState({ active: 0, needsInput: 0, reviewReady: 0 });
  const [error, setError] = useState<ApiFail | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const res = await api<{ cases: Row[]; counts: typeof counts }>(`/api/cases${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    if (res.ok) {
      setRows(res.data.cases);
      setCounts(res.data.counts);
      setError(null);
    } else setError(res.error);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const t = setInterval(load, 8000); // status of running investigations
    return () => clearInterval(t);
  }, [load]);

  const shown = (rows ?? []).filter((r) => (filter === 'all' ? r.status !== 'archived' : filter === 'archived' ? r.status === 'archived' : r.status === filter));

  return (
    <>
      <div className="row-between">
        <h1 style={{ margin: 0, fontSize: '1.7rem' }}>Your cases</h1>
        <Link href="/app/new" className="btn btn-primary">
          New case
        </Link>
      </div>

      <div className="row" style={{ margin: '16px 0' }} role="group" aria-label="Case counts">
        <span className="chip chip-info chip-plain">Active investigations: {counts.active}</span>
        <span className="chip chip-warn chip-plain">Awaiting your input: {counts.needsInput}</span>
        <span className="chip chip-good chip-plain">Ready for review: {counts.reviewReady}</span>
      </div>

      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="row" role="group" aria-label="Filter cases">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={`btn btn-sm ${filter === f.id ? 'btn-primary' : ''}`} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ minWidth: 220, flex: '0 1 320px' }}>
          <label htmlFor="case-search" className="sr-only">
            Search your cases by name or party
          </label>
          <input id="case-search" type="text" placeholder="Search case or party name" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {error ? (
        <div role="alert" className="banner banner-bad">
          {error.message}{' '}
          <button className="btn btn-sm" onClick={load}>
            Retry
          </button>
        </div>
      ) : rows === null ? (
        <div className="stack" aria-busy="true" aria-label="Loading cases">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card">
              <Skeleton h={20} w="50%" />
              <div style={{ height: 8 }} />
              <Skeleton h={14} w="30%" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" style={{ color: 'var(--muted)' }}>
            <path d="M7 3h7l5 5v13H7z" />
            <path d="M14 3v5h5M10 13h6M10 17h6" />
          </svg>
          <p style={{ marginTop: 8 }}>{rows.length ? 'No cases match this filter.' : 'No cases yet. Start with an invoice and any quote or packing list.'}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <Link href="/app/new" className="btn btn-primary">
              Create first case
            </Link>
            <Link href="/demo" className="btn">
              Try a sample case
            </Link>
          </div>
        </div>
      ) : (
        <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {shown.map((r) => (
            <li key={r.id} className="card">
              <div className="row-between">
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', overflowWrap: 'anywhere' }}>{r.name}</h2>
                  <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.9rem' }}>
                    {[r.origin && r.destination ? `${r.origin} → ${r.destination}` : null, r.claimant, r.counterparty ? `vs ${r.counterparty}` : null].filter(Boolean).join(' · ') || 'Details not added yet'}
                  </p>
                </div>
                <StatusChip status={r.status} />
              </div>
              <div className="row-between" style={{ marginTop: 10 }}>
                <div className="muted" style={{ fontSize: '0.88rem' }}>
                  Updated {fmtDateTime(r.updatedAt)}
                  {r.openQuestions ? ` · ${r.openQuestions} question${r.openQuestions === 1 ? '' : 's'} for you` : ''}
                </div>
                <div className="row">
                  {r.differenceDisplay ? (
                    <span className="num" title="A comparison, not a refund">
                      <span className="muted">Difference under review </span>
                      <strong>{r.differenceDisplay}</strong>
                    </span>
                  ) : null}
                  <Link href={`/app/cases/${r.id}`} className="btn btn-sm btn-primary">
                    Open case
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
