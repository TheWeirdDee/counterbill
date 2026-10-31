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
  { id: 'review_ready', label: 'Ready to review' },
  { id: 'archived', label: 'Archived' },
] as const;

/** What the person should do next, derived only from stored status and open questions. */
function nextAction(r: Row): string {
  if (r.status === 'processing') return 'Investigation running';
  if (r.openQuestions) return `Answer ${r.openQuestions} question${r.openQuestions === 1 ? '' : 's'}`;
  switch (r.status) {
    case 'draft':
      return 'Add your records';
    case 'needs_input':
      return 'Add the missing evidence';
    case 'review_ready':
      return 'Review the letter';
    case 'archived':
      return 'Archived';
    default:
      return 'Open the case';
  }
}

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
  const total = (rows ?? []).filter((r) => r.status !== 'archived').length;
  const empty = rows !== null && rows.length === 0 && !q;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cases</h1>
          <p>Each case keeps its records, findings and letter together. Nothing here is sent to anyone.</p>
        </div>
        {empty ? null : (
          <Link href="/app/new" className="btn btn-primary">
            New case
          </Link>
        )}
      </div>

      {empty ? (
        <div className="empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={{ color: 'var(--accent)' }}>
            <path d="M7 3h7l5 5v13H7z" />
            <path d="M14 3v5h5M10 13h6M10 17h4" />
          </svg>
          <h2>Your first case starts with the records.</h2>
          <p>Add an invoice and any quote or packing list you have.</p>
          <div className="row">
            <Link href="/app/new" className="btn btn-primary">
              Create a case
            </Link>
            <Link href="/examples" className="btn">
              Explore an example
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-row" role="group" aria-label="Case counts">
            <div>
              <div className="k">Open cases</div>
              <div className="v">{rows === null ? '–' : total}</div>
            </div>
            <div>
              <div className="k">Investigating</div>
              <div className="v">{rows === null ? '–' : counts.active}</div>
            </div>
            <div>
              <div className="k">Need your input</div>
              <div className="v">{rows === null ? '–' : counts.needsInput}</div>
            </div>
            <div>
              <div className="k">Ready to review</div>
              <div className="v">{rows === null ? '–' : counts.reviewReady}</div>
            </div>
          </div>

          <div className="toolbar">
            <div className="seg" role="group" aria-label="Filter cases">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <div style={{ minWidth: 220, flex: '0 1 320px' }}>
              <label htmlFor="case-search" className="sr-only">
                Search your cases by name or party
              </label>
              <input id="case-search" type="search" placeholder="Search case or party name" value={q} onChange={(e) => setQ(e.target.value)} />
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
            <div className="card" style={{ textAlign: 'center', padding: 36 }}>
              <p style={{ margin: 0 }}>No cases match this filter.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="t stackable case-table">
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Status</th>
                    <th scope="col">Difference under review</th>
                    <th scope="col">Updated</th>
                    <th scope="col">Next</th>
                    <th scope="col">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <td data-label="Case">
                        <Link href={`/app/cases/${r.id}`} className="name" style={{ color: 'var(--text)', textDecoration: 'none' }}>
                          {r.name}
                        </Link>
                        <span className="sub">{[r.origin && r.destination ? `${r.origin} → ${r.destination}` : null, r.counterparty ? `vs ${r.counterparty}` : null].filter(Boolean).join(' · ') || 'Details not added yet'}</span>
                      </td>
                      <td data-label="Status">
                        <StatusChip status={r.status} />
                      </td>
                      <td data-label="Difference" className="num" title="A comparison, not a refund">
                        {r.differenceDisplay ?? <span className="muted">Not yet established</span>}
                      </td>
                      <td data-label="Updated" className="muted">
                        {fmtDateTime(r.updatedAt)}
                      </td>
                      <td data-label="Next">{nextAction(r)}</td>
                      <td data-label="">
                        <Link href={`/app/cases/${r.id}`} className="btn btn-sm">
                          Open<span className="sr-only"> {r.name}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
