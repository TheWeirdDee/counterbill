'use client';

import { useState } from 'react';
import { DOCUMENT_KIND_LABEL, FACT_KEY_LABEL, type DocumentKind, type FactKey } from '@/domain/schemas';
import { displayFact } from '@/domain/format';
import { fmtBytes, fmtDateTime, ReconBadge, SourceChip, StatusChip } from '../ui';
import { useWs } from './context';

// ---------------------------------------------------------------- evidence

export function EvidenceView() {
  const { state, actions, isDemo } = useWs();
  const [sel, setSel] = useState<string | null>(state.documents[0]?.ref ?? null);
  const doc = state.documents.find((d) => d.ref === sel) ?? state.documents[0];
  const facts = state.facts.filter((f) => doc && f.spanRefs.some((s) => s.startsWith(`${doc.ref}-`)));
  return (
    <div className="reader">
      <section aria-labelledby="docs-h">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 id="docs-h" style={{ margin: 0, fontSize: '1.05rem' }}>
            Documents
          </h2>
          {!isDemo || state.demo?.steps.length ? (
            <button type="button" className="btn btn-sm" onClick={actions.openAddEvidence}>
              Add evidence
            </button>
          ) : null}
        </div>
        {state.documents.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No documents yet. Add an invoice and any quote or packing list.
            </p>
          </div>
        ) : (
          <div className="doc-list">
            {state.documents.map((d) => (
              <button key={d.ref} type="button" aria-current={doc?.ref === d.ref} onClick={() => setSel(d.ref)}>
                <strong style={{ overflowWrap: 'anywhere' }}>
                  <span className="mono muted">{d.ref}</span> {d.originalFilename}
                </strong>
                <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                  {DOCUMENT_KIND_LABEL[d.kind as DocumentKind] ?? d.kind} · {fmtBytes(d.sizeBytes)} · {fmtDateTime(d.createdAt)}
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                  <StatusChip status={d.parseStatus} />
                  {d.sourceClass === 'reconstructed_demo' ? <ReconBadge /> : d.sourceClass === 'hypothetical_demo' ? <ReconBadge>Hypothetical illustration</ReconBadge> : null}
                  {d.ocr ? <span className="chip chip-warn chip-plain">OCR</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="doc-detail-h">
        {doc ? (
          <div className="card">
            <h2 id="doc-detail-h" style={{ fontSize: '1.05rem', overflowWrap: 'anywhere' }}>
              {doc.originalFilename}
            </h2>
            <div className="row">
              <StatusChip status={doc.parseStatus} />
              <span className="chip chip-plain">{doc.sourceClassLabel}</span>
              {doc.version > 1 ? <span className="chip chip-plain">version {doc.version}</span> : null}
            </div>
            {doc.parseStatus !== 'ready' ? (
              <p className="muted">{doc.parseError ?? 'Not read yet.'}</p>
            ) : (
              <p className="muted">
                {doc.spanCount} citable passages across {doc.pageCount} page{doc.pageCount === 1 ? '' : 's'}.
              </p>
            )}
            <div className="row" style={{ margin: '8px 0 12px' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => actions.openSource(doc.ref)}>
                Read document
              </button>
              {!isDemo && (doc.parseStatus === 'needs_manual_review' || doc.parseStatus === 'failed') ? (
                <button type="button" className="btn btn-sm" onClick={() => actions.openManualEntry(doc.ref)}>
                  Enter figures by hand
                </button>
              ) : null}
            </div>
            <h3 style={{ fontSize: '0.95rem' }}>Facts taken from this document</h3>
            {facts.length === 0 ? (
              <p className="muted">{doc.parseStatus === 'ready' ? 'None recorded yet.' : 'Nothing could be read.'}</p>
            ) : (
              <div className="table-wrap">
                <table className="t stackable">
                  <caption className="sr-only">Facts from {doc.originalFilename}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Fact</th>
                      <th scope="col" className="r">
                        Value
                      </th>
                      <th scope="col">Source</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {facts.map((f) => (
                      <tr key={f.ref} style={f.status !== 'active' ? { opacity: 0.65 } : undefined}>
                        <td data-label="Fact">
                          {FACT_KEY_LABEL[f.key as FactKey] ?? f.key}
                          {f.subject ? ` (${f.subject})` : ''}
                        </td>
                        <td data-label="Value" className="r num">
                          {displayFact(f)}
                        </td>
                        <td data-label="Source">
                          <SourceChip refId={f.ref} />{' '}
                          {f.spanRefs.map((s) => (
                            <SourceChip key={s} refId={s} onOpen={actions.openSource} />
                          ))}
                        </td>
                        <td data-label="Status">{f.status === 'superseded' ? <StatusChip status="superseded" label="Superseded by correction" /> : f.provenance === 'user_correction' ? <StatusChip status="provisional" label="User-corrected" /> : <span className="muted">{f.confidence ?? 'extracted'}</span>}</td>
                        <td data-label="">
                          {f.status === 'active' && !isDemo ? (
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
          </div>
        ) : (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              Select a document to read it.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- findings

export function FindingsView() {
  const { state, actions, isDemo } = useWs();
  const active = state.findings.filter((f) => f.status !== 'superseded');
  const superseded = state.findings.filter((f) => f.status === 'superseded');
  const groups = [
    { id: 'supported_discrepancy', title: 'Supported discrepancies', hint: 'Arithmetic differences that cited sources support. They are comparisons, not entitlements.' },
    { id: 'competing_explanation', title: 'Competing explanations', hint: 'Conflicting accounts, ambiguous terms, or a possible legitimate basis for the charge.' },
    { id: 'missing_evidence', title: 'Missing evidence', hint: 'Terms, documents or confirmations the case still needs.' },
  ];
  const [showOld, setShowOld] = useState(false);
  const currentCalcs = state.calculations.filter((c) => c.status === 'current');

  const card = (f: (typeof state.findings)[number]) => {
    const calcs = state.calculations.filter((c) => f.calcRefs.includes(c.ref));
    return (
      <article key={f.ref} className={`finding s-${f.status}`} aria-labelledby={`f-${f.ref}`}>
        <div className="row" style={{ marginBottom: 6 }}>
          <StatusChip status={f.status} />
          <StatusChip status={f.severity} />
          {f.basis === 'inference' ? <span className="chip chip-plain">Labelled inference</span> : null}
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {f.ref} · by {f.producedBy} · updated {fmtDateTime(f.updatedAt)}
          </span>
        </div>
        <h3 id={`f-${f.ref}`}>{f.title}</h3>
        <p style={{ marginBottom: 8 }}>{f.explanation}</p>
        {calcs.length ? (
          <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
            {calcs.map((c) => (
              <div key={c.ref} className="formula">
                {c.formula}
              </div>
            ))}
          </div>
        ) : null}
        {f.changeReason ? (
          <p className="muted" style={{ fontSize: '0.86rem' }}>
            Note: {f.changeReason}
          </p>
        ) : null}
        <div className="row">
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Sources:
          </span>
          {[...f.factRefs, ...f.calcRefs, ...f.spanRefs].map((r) => (
            <SourceChip key={r} refId={r} onOpen={actions.openSource} />
          ))}
          {[...f.factRefs, ...f.calcRefs, ...f.spanRefs].length === 0 ? <span className="muted">no document location (inference)</span> : null}
        </div>
        {f.status !== 'superseded' ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-sm" onClick={() => actions.openChallenge(f.ref)}>
              Challenge finding
            </button>
            {(f.factRefs[0] ?? f.spanRefs[0]) ? (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => actions.openSource((f.spanRefs[0] ?? f.factRefs[0])!)}>
                See sources
              </button>
            ) : null}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: '0.84rem', margin: '8px 0 0' }}>
            Superseded by {f.supersededByRef ?? 'a newer reading'}. Kept so you can see how the conclusion changed.
          </p>
        )}
      </article>
    );
  };

  return (
    <div className="stack">
      <div>
        <h2 style={{ marginBottom: 4 }}>What we found</h2>
        <p className="muted" style={{ margin: 0 }}>
          {active.length} current finding{active.length === 1 ? '' : 's'}, {superseded.length} superseded. A billing difference is not automatically a recoverable overcharge: measured, declared, billed and chargeable volume are different things.
        </p>
      </div>
      {state.readiness.ready === false ? <div className="banner banner-warn">{state.readiness.message}</div> : null}
      {active.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            {state.activeRun ? 'Findings appear here as the agents report them.' : 'No findings yet.'}
          </p>
        </div>
      ) : null}
      {groups.map((g) => {
        const items = active.filter((f) => f.category === g.id);
        if (!items.length) return null;
        return (
          <section key={g.id} aria-labelledby={`g-${g.id}`}>
            <h3 id={`g-${g.id}`} style={{ marginBottom: 2 }}>
              {g.title} <span className="muted num">({items.length})</span>
            </h3>
            <p className="muted" style={{ fontSize: '0.86rem' }}>
              {g.hint}
            </p>
            {items.map(card)}
          </section>
        );
      })}

      <section className="card" aria-labelledby="calc-h">
        <h3 id="calc-h">Calculations</h3>
        {currentCalcs.length === 0 ? (
          <p className="muted">No calculation yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="t stackable">
              <caption className="sr-only">Deterministic calculations</caption>
              <thead>
                <tr>
                  <th scope="col">Ref</th>
                  <th scope="col">Calculation</th>
                  <th scope="col" className="r">
                    Result
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentCalcs.map((c) => (
                  <tr key={c.ref}>
                    <td data-label="Ref">
                      <SourceChip refId={c.ref} onOpen={actions.openSource} />
                    </td>
                    <td data-label="Calculation">
                      <strong>{c.label}</strong>
                      <div className="formula" style={{ marginTop: 4 }}>
                        {c.formula}
                      </div>
                    </td>
                    <td data-label="Result" className="r num">
                      <strong>{c.display}</strong>
                      {c.kind === 'charge_difference' ? <div className="muted" style={{ fontSize: '0.76rem' }}>comparison, not a refund</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: '0.84rem', marginBottom: 0 }}>
          CBM (cubic metres) = length × width × height in metres. Each package is calculated from its dimensions and the unrounded volumes are summed; rounding is applied only for display. These figures are produced by code with exact decimals, not by the language model.
        </p>
      </section>

      {superseded.length ? (
        <section aria-labelledby="old-h">
          <div className="row-between">
            <h3 id="old-h" style={{ margin: 0 }}>
              Earlier readings (superseded)
            </h3>
            <button type="button" className="btn btn-sm" aria-expanded={showOld} onClick={() => setShowOld((s) => !s)}>
              {showOld ? 'Hide' : `Show ${superseded.length}`}
            </button>
          </div>
          {showOld ? <div style={{ marginTop: 10 }}>{superseded.map(card)}</div> : null}
        </section>
      ) : null}
      {isDemo ? null : null}
    </div>
  );
}

// ---------------------------------------------------------------- timeline

export function TimelineView() {
  const { state, actions, isDemo } = useWs();
  const items = state.timeline;
  const events = items.filter((t) => t.kind === 'event');
  const conflicts = items.filter((t) => t.kind === 'conflict');
  const gaps = items.filter((t) => t.kind === 'gap');
  const userQ = state.questions.filter((q) => q.status === 'open' && q.audience === 'user');
  const suggestions = ['The original quote or rate sheet that shows how chargeable volume is calculated', 'WhatsApp or email messages with the freight company about the booking', 'Invoice metadata: issue date and invoice number', 'A signed survey or measurement report'];
  return (
    <div className="two-col" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
      <section aria-labelledby="tl-h">
        <h2 id="tl-h">Timeline</h2>
        {events.length === 0 ? (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              {state.activeRun ? 'The Timeline Agent is reading the documents…' : 'No dated events are established yet. Dates are never guessed from upload order.'}
            </p>
          </div>
        ) : (
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, borderLeft: '2px solid var(--border-strong)' }}>
            {events.map((t) => (
              <li key={t.ref} style={{ position: 'relative', padding: '0 0 16px 18px' }}>
                <span style={{ position: 'absolute', left: -7, top: 6, width: 12, height: 12, borderRadius: '50%', background: t.occurredOn ? 'var(--accent)' : 'var(--surface)', border: '2px solid var(--accent)' }} aria-hidden="true" />
                <div className="card" style={{ padding: 12 }}>
                  <strong className="num">{t.occurredOn ?? 'Date not established'}</strong>
                  {t.actor ? <span className="muted"> · {t.actor}</span> : null}
                  <p style={{ margin: '4px 0 6px' }}>{t.description}</p>
                  {t.spanRefs.map((s) => (
                    <SourceChip key={s} refId={s} onOpen={actions.openSource} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
        {conflicts.length ? (
          <>
            <h3>Conflicting accounts</h3>
            <p className="muted" style={{ fontSize: '0.88rem' }}>
              Shown side by side. No order is invented.
            </p>
            <div className="cards">
              {conflicts.map((c) => (
                <div key={c.ref} className="card" style={{ borderColor: 'var(--warn)' }}>
                  <p style={{ margin: '0 0 6px' }}>{c.description}</p>
                  {c.spanRefs.map((s) => (
                    <SourceChip key={s} refId={s} onOpen={actions.openSource} />
                  ))}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </section>
      <section aria-labelledby="miss-h">
        <h2 id="miss-h">What is missing?</h2>
        <div className="card">
          {gaps.length ? (
            <ul style={{ paddingLeft: '1.1em', marginTop: 0 }}>
              {gaps.map((g) => (
                <li key={g.ref}>{g.description}</li>
              ))}
            </ul>
          ) : null}
          {userQ.length ? (
            <>
              <h3 style={{ fontSize: '0.95rem' }}>Questions for you</h3>
              <ul style={{ paddingLeft: '1.1em' }}>
                {userQ.map((q) => (
                  <li key={q.ref}>{q.prompt}</li>
                ))}
              </ul>
              <button type="button" className="btn btn-sm btn-primary" onClick={actions.openQuestions}>
                Answer questions
              </button>
            </>
          ) : null}
          <h3 style={{ fontSize: '0.95rem', marginTop: 12 }}>Evidence that would help</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
            {suggestions.map((s) => (
              <li key={s}>
                <button type="button" className="btn btn-sm" style={{ width: '100%', textAlign: 'left', justifyContent: 'flex-start', height: 'auto' }} onClick={isDemo ? actions.openAddEvidence : actions.openAddEvidence}>
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
