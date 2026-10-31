'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ASSESSMENT_CLASS_LABEL, DOCUMENT_KIND_LABEL, FACT_KEY_LABEL, type DocumentKind, type FactKey } from '@/domain/schemas';
import { displayFact } from '@/domain/format';
import { api, fmtDateTime, fmtTime, ReconBadge, SourceChip, StatusChip } from '../ui';
import { describeEvent, ROLE_BLURB, ROLE_LABEL, useWs } from './context';

export function EvidenceNavigator() {
  const { state, actions, isDemo } = useWs();
  const [filter, setFilter] = useState('');
  const docs = state.documents.filter((d) => !filter || `${d.originalFilename} ${d.kind}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <section className="card col-sticky" aria-labelledby="ev-nav-h">
      <div className="card-title">
        <h2 id="ev-nav-h" style={{ margin: 0, fontSize: '1rem' }}>
          Evidence
        </h2>
        <span className="muted num">{state.documents.length}</span>
      </div>
      {state.documents.length > 4 ? (
        <div className="field">
          <label htmlFor="ev-filter" className="sr-only">
            Filter documents
          </label>
          <input id="ev-filter" type="text" placeholder="Filter documents" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      ) : null}
      {docs.length === 0 ? (
        <p className="muted">No documents yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {docs.map((d) => (
            <li key={d.ref}>
              <button type="button" onClick={() => actions.openSource(d.ref)} className="btn" style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', display: 'block', height: 'auto', padding: '8px 10px' }} aria-label={`Open ${d.originalFilename}`}>
                <span style={{ display: 'block', fontWeight: 700, overflowWrap: 'anywhere' }}>
                  <span className="mono muted">{d.ref}</span> {d.originalFilename}
                </span>
                <span className="muted" style={{ display: 'block', fontSize: '0.8rem', fontWeight: 500 }}>
                  {DOCUMENT_KIND_LABEL[d.kind as DocumentKind] ?? d.kind} · {fmtDateTime(d.createdAt)}
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <StatusChip status={d.parseStatus} />
                  {d.sourceClass === 'reconstructed_demo' || d.sourceClass === 'hypothetical_demo' ? <ReconBadge>{d.sourceClass === 'hypothetical_demo' ? 'Hypothetical illustration' : 'Reconstructed'}</ReconBadge> : null}
                  {d.sourceClass === 'official_public_report' ? <span className="chip chip-info chip-plain">Public report excerpt</span> : null}
                  {d.sourceClass === 'user_statement' ? <span className="chip chip-plain">Your statement</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isDemo || state.demo?.steps.length ? (
        <button type="button" className="btn btn-sm" style={{ marginTop: 12, width: '100%' }} onClick={actions.openAddEvidence}>
          Add evidence
        </button>
      ) : null}
    </section>
  );
}

export function ActivityRail() {
  const { state, events, connection, actions, base } = useWs();
  const recent = events.filter((e) => !e.type.startsWith('mozaik.') && e.type !== 'agent.started').slice(-6).reverse();
  const failedAgents = state.agents.filter((a) => a.status === 'failed');
  const [busy, setBusy] = useState(false);

  async function retry() {
    setBusy(true);
    await api(`/api/cases/${state.case.id}/retry`, { method: 'POST' });
    setBusy(false);
    await actions.refetch();
  }

  return (
    <section className="card col-sticky" aria-labelledby="act-h">
      <div className="card-title">
        <h2 id="act-h" style={{ margin: 0, fontSize: '1rem' }}>
          Agents
        </h2>
        <span className="chip chip-plain" role="status" aria-live="off">
          <span className={`pulse${connection === 'live' ? ' live' : ''}`} aria-hidden="true" style={{ marginRight: 4, background: connection === 'live' ? 'var(--good)' : 'var(--warn)' }} />
          {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Reconnecting…'}
        </span>
      </div>
      {connection === 'reconnecting' ? (
        <p className="muted" style={{ fontSize: '0.84rem' }}>
          Connection interrupted. Missed updates are replayed from the saved log when it returns.
        </p>
      ) : null}
      {state.agents.map((a) => {
        const live = a.status === 'investigating' || a.status === 'revising';
        const running = a.tasks.filter((t) => t.status === 'running').at(-1);
        return (
          <details key={a.role} className="agent-row" open={live || a.status === 'failed'}>
            <summary>
              <span className="row-between" style={{ gap: 8 }}>
                <strong>{ROLE_LABEL[a.role]}</strong>
                <span className="chip chip-plain" data-status={a.status} style={{ background: live ? 'var(--accent-soft)' : a.status === 'failed' ? 'var(--bad-soft)' : a.status === 'finished' ? 'var(--good-soft)' : undefined }}>
                  {live ? <span className="pulse live" aria-hidden="true" /> : null}
                  {a.status === 'idle' ? 'Idle' : a.status === 'queued' ? 'Queued' : a.status === 'investigating' ? 'Investigating' : a.status === 'revising' ? 'Revising' : a.status === 'finished' ? 'Finished' : 'Failed'}
                </span>
              </span>
              <span className="muted" style={{ fontSize: '0.82rem' }}>
                {running ? running.taskLabel : (a.summary ?? ROLE_BLURB[a.role])}
              </span>
            </summary>
            <div className="body">
              {a.summary ? <p style={{ margin: '0 0 6px', color: 'var(--ink)' }}>{a.summary}</p> : null}
              {a.error ? (
                <p role="alert" className="error-text" style={{ margin: '0 0 6px' }}>
                  {a.error}
                </p>
              ) : null}
              {a.tasks.length ? (
                <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
                  {a.tasks.map((t) => (
                    <li key={t.id}>
                      {fmtTime(t.startedAt)} → {t.finishedAt ? fmtTime(t.finishedAt) : 'running'} · {t.status}
                      {t.mozaikLoopId ? <span className="mono"> · loop {t.mozaikLoopId.slice(0, 8)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ margin: 0 }}>{ROLE_BLURB[a.role]}.</p>
              )}
            </div>
          </details>
        );
      })}
      {failedAgents.length ? (
        <div className="banner banner-bad" role="alert" style={{ marginTop: 10 }}>
          <strong>{failedAgents.map((a) => ROLE_LABEL[a.role]).join(', ')} did not complete.</strong> Results from the other agents are kept.
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={retry} disabled={busy}>
              {busy ? 'Retrying…' : 'Retry failed agents'}
            </button>
          </div>
        </div>
      ) : null}
      <h3 style={{ margin: '14px 0 6px', fontSize: '0.9rem' }}>Recent</h3>
      {recent.length === 0 ? (
        <p className="muted" style={{ fontSize: '0.86rem' }}>
          Nothing has happened yet.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.84rem' }}>
          {recent.map((e) => (
            <li key={e.seq} style={{ padding: '4px 0', borderTop: '1px solid var(--border)' }}>
              <span className="mono muted">{fmtTime(e.timestamp).slice(0, 8)}</span> <strong>{ROLE_LABEL[e.agentId] ?? e.agentId}</strong>: {describeEvent(e)}
            </li>
          ))}
        </ul>
      )}
      <Link href={`${base}/activity`} className="btn btn-sm btn-ghost" style={{ marginTop: 8 }}>
        Full activity and trace
      </Link>
    </section>
  );
}

export function Canvas() {
  const { state, actions, base, isDemo } = useWs();
  const a = state.latestAssessment;
  const diff = (a?.changeDiff ?? {}) as {
    classification?: { from: string; to: string } | null;
    numbers?: { topic: string; from: string; to: string }[];
    revised?: { from: { ref: string; title: string; status: string } | null; to: { ref: string; title: string; status: string } }[];
    withdrawn?: { ref: string; title: string; reason: string | null }[];
    created?: { ref: string; title: string }[];
    changed?: boolean;
  };
  const showChange = a && a.version > 1 && (diff.changed ?? true);
  const facts = state.facts.filter((f) => f.status === 'active');
  const keyFacts = facts.filter((f) => ['billed_volume_cbm', 'declared_volume_cbm', 'measured_volume_cbm', 'rate_per_cbm', 'minimum_chargeable_cbm', 'billed_freight_amount'].includes(f.key));
  const calcsCurrent = state.calculations.filter((c) => c.status === 'current');
  const diffs = calcsCurrent.filter((c) => c.kind === 'charge_difference');
  const missing = state.findings.filter((f) => f.status !== 'superseded' && f.category === 'missing_evidence');
  const openUserQ = state.questions.filter((q) => q.status === 'open' && q.audience === 'user');
  const last = state.latestRun;
  const running = !!state.activeRun;

  return (
    <div className="stack">
      {state.demo ? <DemoSteps /> : null}

      {!state.readiness.ready ? (
        <div className="banner banner-warn" role="status">
          <strong>Live investigation is not configured on this server.</strong> {state.readiness.message}
        </div>
      ) : last?.inferenceMode === 'test' ? (
        <div className="banner banner-warn" role="status">
          <strong>Test mode.</strong> A deterministic stand-in produced the agent outputs for this run. The agents, events, validation and database are real; the model is not. Do not treat results as live AI.
        </div>
      ) : null}

      {last && (last.status === 'failed' || last.status === 'partial') && !running ? (
        <div className="banner banner-bad" role="alert">
          <strong>{last.status === 'partial' ? 'The investigation finished with limitations.' : 'The investigation could not finish.'}</strong> {last.errorMessage ?? 'Part of the work failed.'} Facts and findings already recorded are kept.
        </div>
      ) : null}

      {running ? (
        <div className="banner banner-info" role="status" aria-live="polite">
          <strong>{state.activeRun!.kind === 'reassess' ? 'Reassessing with the new evidence…' : state.activeRun!.status === 'queued' ? 'Waiting for a worker…' : 'Investigating…'}</strong> Only the agents affected by this change are woken. Results appear below as each agent reports.
        </div>
      ) : null}

      {showChange ? (
        <section className="change-banner" aria-labelledby="chg-h">
          <h2 id="chg-h" style={{ margin: 0, fontSize: '1.05rem' }}>
            What changed, and why
          </h2>
          <p style={{ margin: '6px 0 0' }}>{a.changeReason ?? 'The assessment was revised after new evidence.'}</p>
          <ul>
            {diff.classification && diff.classification.from !== diff.classification.to ? (
              <li>
                Reading: “{ASSESSMENT_CLASS_LABEL[diff.classification.from as keyof typeof ASSESSMENT_CLASS_LABEL] ?? diff.classification.from}” → “{ASSESSMENT_CLASS_LABEL[diff.classification.to as keyof typeof ASSESSMENT_CLASS_LABEL] ?? diff.classification.to}”
              </li>
            ) : null}
            {(diff.numbers ?? []).map((n) => (
              <li key={n.topic}>
                <span className="num">
                  Difference ({n.topic.split(':')[0].replace(/_/g, ' ')}): {n.from} → <strong>{n.to}</strong>
                </span>
              </li>
            ))}
            {(diff.revised ?? []).map((r) => (
              <li key={r.to.ref}>
                Finding <SourceChip refId={r.from?.ref ?? '—'} /> “{r.from?.title ?? 'earlier reading'}” is now superseded by <SourceChip refId={r.to.ref} /> “{r.to.title}”.
              </li>
            ))}
            {(diff.withdrawn ?? []).map((w) => (
              <li key={w.ref}>
                Withdrawn: <SourceChip refId={w.ref} /> {w.title}
                {w.reason ? ` — ${w.reason}` : ''}
              </li>
            ))}
            {(diff.created ?? []).map((c) => (
              <li key={c.ref}>
                New: <SourceChip refId={c.ref} /> {c.title}
              </li>
            ))}
          </ul>
          <Link href={`${base}/activity`} className="btn btn-sm">
            Why this changed: trace
          </Link>{' '}
          <Link href={`${base}/findings`} className="btn btn-sm">
            See earlier readings
          </Link>
        </section>
      ) : null}

      <section className="card" aria-labelledby="top-h">
        <p className="eyebrow">Current reading</p>
        {a ? (
          <>
            <h2 id="top-h">{ASSESSMENT_CLASS_LABEL[a.classification as keyof typeof ASSESSMENT_CLASS_LABEL] ?? a.classification}</h2>
            <p>{a.headline}</p>
            <p className="muted">{a.summary}</p>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              <strong>Strongest contrary explanation:</strong> {a.strongestCounter}
            </p>
            <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
              Assessment v{a.version} · evidence revision {a.evidenceRevision} · {fmtDateTime(a.createdAt)}
            </p>
          </>
        ) : (
          <>
            <h2 id="top-h">{running ? 'The agents are reading your documents…' : 'No assessment yet'}</h2>
            <p className="muted">
              {running ? 'Facts and calculations appear below as soon as they are recorded. You do not have to wait for every agent to finish.' : state.case.status === 'draft' ? 'Start the investigation to compare your records.' : 'There is nothing to assess yet. Add a document or answer a question.'}
            </p>
            {running ? <div className="skeleton" style={{ height: 14, width: '70%' }} aria-hidden="true" /> : null}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="says-h">
        <h2 id="says-h" style={{ fontSize: '1.05rem' }}>
          What the documents say
        </h2>
        {keyFacts.length === 0 ? (
          <p className="muted">{running ? 'Waiting for the Evidence Agent…' : 'No billing facts have been recorded yet.'}</p>
        ) : (
          <div className="table-wrap">
            <table className="t stackable">
              <caption className="sr-only">Recorded facts with their sources</caption>
              <thead>
                <tr>
                  <th scope="col">Fact</th>
                  <th scope="col" className="r">
                    Value
                  </th>
                  <th scope="col">Where it comes from</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keyFacts.map((f) => (
                  <tr key={f.ref}>
                    <td data-label="Fact">{FACT_KEY_LABEL[f.key as FactKey] ?? f.key}</td>
                    <td data-label="Value" className="r num">
                      <strong>{displayFact(f)}</strong>
                    </td>
                    <td data-label="Source">
                      <SourceChip refId={f.ref} onOpen={actions.openSource} />{' '}
                      {f.spanRefs.slice(0, 2).map((s) => (
                        <SourceChip key={s} refId={s} onOpen={actions.openSource} />
                      ))}{' '}
                      <span className="muted" style={{ fontSize: '0.8rem' }}>
                        {f.provenance === 'user_correction' ? 'corrected by you' : f.provenance === 'user_statement' ? 'your statement' : 'extracted'}
                      </span>
                    </td>
                    <td data-label="">
                      {!isDemo ? (
                        <button type="button" className="btn btn-sm" onClick={() => actions.openCorrect(f.ref)}>
                          Correct
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="diffs-h">
        <h2 id="diffs-h" style={{ fontSize: '1.05rem' }}>
          Differences found
        </h2>
        {diffs.length === 0 ? (
          <p className="muted">{running ? 'Waiting for the Billing Agent…' : 'Not yet established: a comparison needs a billed volume, a second volume and a rate.'}</p>
        ) : (
          diffs.map((d) => {
            const group = d.topic.split(':')[0];
            const related = calcsCurrent.filter((c) => c.topic.startsWith(`${group}:`) && c.kind !== 'charge_difference');
            const title = group === 'billed_vs_measured' ? 'Billed vs surveyed volume' : group === 'billed_vs_declared' ? 'Billed vs packing-list estimate' : group === 'billed_vs_contract_term' ? 'Under the stated contract minimum' : group;
            return (
              <div key={d.ref} className="finding s-provisional" style={{ marginBottom: 10 }}>
                <div className="row-between">
                  <h3 style={{ margin: 0 }}>{title}</h3>
                  <span className="num" style={{ fontSize: '1.25rem', fontWeight: 800 }} title="A comparison, not a refund">
                    {d.display}
                  </span>
                </div>
                <p className="muted" style={{ margin: '4px 0 8px', fontSize: '0.86rem' }}>
                  Comparison under stated assumptions, not an amount owed.
                </p>
                {[...related, d].map((c) => (
                  <p key={c.ref} className="formula" style={{ margin: '4px 0' }}>
                    <SourceChip refId={c.ref} onOpen={actions.openSource} /> {c.formula}
                  </p>
                ))}
              </div>
            );
          })
        )}
      </section>

      <section className="card" aria-labelledby="cannot-h">
        <h2 id="cannot-h" style={{ fontSize: '1.05rem' }}>
          What we cannot establish
        </h2>
        {missing.length === 0 && !state.interpretation ? (
          <p className="muted">{running ? 'Waiting for the Contract Agent…' : 'Nothing is flagged as missing yet.'}</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.1em' }}>
            {state.interpretation?.termsStatus === 'terms_missing' ? (
              <li>
                <strong>The contractual chargeable-volume basis.</strong> No document states how chargeable volume is determined, so a difference in volume is not shown to be an overcharge.
              </li>
            ) : null}
            {missing.map((m) => (
              <li key={m.ref}>
                <strong>{m.title.replace(/^Missing: /, '')}.</strong> {m.explanation}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="next-h">
        <h2 id="next-h" style={{ fontSize: '1.05rem' }}>
          Next action
        </h2>
        <p>{a?.nextAction ?? 'Start the investigation, then review what the agents found.'}</p>
        {openUserQ.length ? (
          <>
            <h3 style={{ fontSize: '0.95rem' }}>Questions for you</h3>
            <ul style={{ margin: '0 0 8px', paddingLeft: '1.1em' }}>
              {openUserQ.slice(0, 3).map((q) => (
                <li key={q.ref}>{q.prompt}</li>
              ))}
            </ul>
            <button type="button" className="btn btn-sm btn-primary" onClick={actions.openQuestions}>
              Answer questions
            </button>
          </>
        ) : null}
        <p className="muted" style={{ marginTop: 12, marginBottom: 0 }}>
          Draft letter:{' '}
          {state.draft ? (
            <>
              v{state.draft.version} {state.stale.draft ? <StatusChip status="needs_input" label="Stale: evidence changed" /> : <StatusChip status="ready" label="Up to date" />}{' '}
              <Link href={`${base}/letter`}>Review the letter</Link>
            </>
          ) : running ? (
            'the Drafting Agent writes it once there is a sourced assessment.'
          ) : (
            'not written yet.'
          )}
        </p>
      </section>
    </div>
  );
}

function DemoSteps() {
  const { state, actions } = useWs();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!state.demo) return null;
  async function add(stepId: string) {
    setBusy(stepId);
    setError(null);
    const res = await api(`/api/cases/${state.case.id}/demo-evidence`, { method: 'POST', body: JSON.stringify({ stepId }) });
    if (!res.ok) setError(res.error.message);
    setBusy(null);
    await actions.refetch();
  }
  return (
    <section className="card" aria-labelledby="demo-h" style={{ borderColor: 'var(--accent)' }}>
      <p className="eyebrow">Sample case</p>
      <h2 id="demo-h" style={{ fontSize: '1.05rem' }}>
        {state.case.sampleLabel}
      </h2>
      <p className="muted" style={{ marginBottom: 8 }}>
        Source:{' '}
        <a href={state.demo.source.url} target="_blank" rel="noopener noreferrer">
          {state.demo.source.publisher}, “{state.demo.source.title}”, {state.demo.source.published}
        </a>
        . {state.demo.source.limitation}
      </p>
      {state.demo.steps.length ? (
        <div className="stack">
          {state.demo.steps.map((s) => (
            <div key={s.id} className="row-between" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 260px' }}>
                <strong>{s.title}</strong>
                <div className="muted" style={{ fontSize: '0.88rem' }}>
                  {s.description}
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-sm" disabled={s.added || !!busy || !state.documents.length || !state.latestAssessment} onClick={() => add(s.id)}>
                {s.added ? 'Added' : busy === s.id ? 'Adding…' : s.id === 'survey' ? 'Add published survey finding' : 'Add hypothetical rate sheet'}
              </button>
            </div>
          ))}
          {!state.latestAssessment ? <p className="muted" style={{ margin: 0, fontSize: '0.86rem' }}>Available once the first assessment is in.</p> : null}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : null}
    </section>
  );
}
