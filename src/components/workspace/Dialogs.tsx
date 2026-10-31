'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL, FACT_KEY_LABEL, SOURCE_CLASS_LABEL, type DocumentKind, type FactKey } from '@/domain/schemas';
import type { DocumentRow, FactRow, SpanRow } from '@/db/repo';
import { api, Dialog, fmtBytes, fmtDateTime, ReconBadge, SourceChip, StatusChip, type ApiFail } from '../ui';
import { useWs } from './context';

// ---------------------------------------------------------------- document viewer

export function DocumentViewer({ docRef, spanRef, onClose }: { docRef: string | null; spanRef: string | null; onClose: () => void }) {
  const { state, actions, isDemo } = useWs();
  const [data, setData] = useState<{ document: DocumentRow; spans: SpanRow[]; facts: FactRow[] } | null>(null);
  const [error, setError] = useState<ApiFail | null>(null);
  const [focus, setFocus] = useState<string | null>(spanRef);
  const hlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocus(spanRef);
  }, [spanRef, docRef]);

  useEffect(() => {
    if (!docRef) return;
    setData(null);
    setError(null);
    void (async () => {
      const res = await api<{ document: DocumentRow; spans: SpanRow[]; facts: FactRow[] }>(`/api/cases/${state.case.id}/documents/${docRef}`);
      if (res.ok) setData(res.data);
      else setError(res.error);
    })();
  }, [docRef, state.case.id, state.documents.length]);

  useEffect(() => {
    hlRef.current?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [data, focus]);

  const doc = data?.document;
  const meta = state.documents.find((d) => d.ref === docRef);
  const pages = data ? [...new Set(data.spans.map((s) => s.page))] : [];
  const cited = (data?.facts ?? []).filter((f) => f.status === 'active');

  return (
    <Dialog open={!!docRef} onClose={onClose} title={meta ? `${meta.ref} · ${meta.originalFilename}` : 'Document'} wide footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      {error ? (
        <p role="alert" className="error-text">
          {error.message}
        </p>
      ) : !data || !doc ? (
        <div aria-busy="true" className="stack">
          <div className="skeleton" style={{ height: 18, width: '60%' }} />
          <div className="skeleton" style={{ height: 90 }} />
        </div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <StatusChip status={doc.parseStatus} />
            <span className="chip chip-plain">{DOCUMENT_KIND_LABEL[doc.kind as DocumentKind] ?? doc.kind}</span>
            {doc.ocr ? <span className="chip chip-warn chip-plain">OCR</span> : <span className="chip chip-plain">{doc.extractionMethod ?? 'text'}</span>}
            {doc.parseConfidence != null ? <span className="chip chip-plain" title="Operational cue only. It is not proof the content is true.">extraction confidence {Math.round(Number(doc.parseConfidence) * 100)}%</span> : null}
            <span className="muted">
              {fmtBytes(doc.sizeBytes)} · v{doc.version}
              {doc.pageCount ? ` · ${doc.pageCount} page${doc.pageCount === 1 ? '' : 's'}` : ''}
            </span>
          </div>
          {doc.sourceClass !== 'primary_document' ? (
            <div className={`banner ${doc.sourceClass === 'official_public_report' ? 'banner-info' : 'banner-warn'}`} style={{ marginBottom: 12 }}>
              <strong>{doc.sourceLabel ?? SOURCE_CLASS_LABEL[doc.sourceClass as keyof typeof SOURCE_CLASS_LABEL]}.</strong>
              {doc.sourceUrl ? (
                <>
                  {' '}
                  <a href={doc.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Public source{doc.sourcePublished ? ` (${doc.sourcePublished})` : ''}
                  </a>
                  . Excerpts are cached locally, so this document stays readable if the source page is unavailable.
                </>
              ) : null}
            </div>
          ) : (
            <p className="muted" style={{ fontSize: '0.86rem' }}>
              Uploaded document. Its authenticity has not been independently verified.
            </p>
          )}
          {doc.parseStatus !== 'ready' ? (
            <div className="banner banner-warn" role="status" style={{ marginBottom: 12 }}>
              {doc.parseError ?? 'This document has not been read yet.'}
              {!isDemo && (doc.parseStatus === 'needs_manual_review' || doc.parseStatus === 'failed') ? (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => actions.openManualEntry(doc.ref)}>
                    Enter the key figures by hand
                  </button>{' '}
                  <span className="muted">The case continues on the facts you can provide; results stay provisional.</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {cited.length ? (
            <div className="row" style={{ marginBottom: 10 }}>
              <label htmlFor="jump" className="muted" style={{ fontSize: '0.86rem' }}>
                Jump to citation
              </label>
              <select
                id="jump"
                style={{ width: 'auto', minWidth: 220 }}
                value=""
                onChange={(e) => {
                  if (e.target.value) setFocus(e.target.value);
                }}
              >
                <option value="">Choose a cited fact…</option>
                {cited.flatMap((f) => f.spanRefs.filter((s) => s.startsWith(`${doc.ref}-`)).map((s) => (
                  <option key={`${f.ref}-${s}`} value={s}>
                    {f.ref} · {FACT_KEY_LABEL[f.key as FactKey] ?? f.key} · {s}
                  </option>
                )))}
              </select>
              {doc.mime === 'application/pdf' || doc.mime.startsWith('image/') ? (
                <a className="btn btn-sm" href={`/api/cases/${state.case.id}/documents/${doc.ref}/preview`} target="_blank" rel="noopener noreferrer">
                  Open original
                </a>
              ) : null}
            </div>
          ) : null}

          {pages.length === 0 ? (
            <p className="muted">No readable text.</p>
          ) : (
            pages.map((p) => (
              <section key={p} aria-label={`Page ${p}`}>
                {doc.pageCount > 1 ? <h3 style={{ fontSize: '0.9rem' }}>Page {p}</h3> : null}
                {data.spans
                  .filter((s) => s.page === p)
                  .map((s) => {
                    const hl = s.ref === focus;
                    const facts = cited.filter((f) => f.spanRefs.includes(s.ref));
                    return (
                      <div key={s.ref} ref={hl ? hlRef : undefined} className={`span-block${hl ? ' hl' : ''}`} id={s.ref} aria-current={hl ? 'true' : undefined}>
                        <span className="ref">{s.ref.split('-').slice(1).join('-')}</span>
                        <span>
                          {s.text}
                          {facts.length ? (
                            <span style={{ display: 'block', marginTop: 2 }}>
                              {facts.map((f) => (
                                <span key={f.ref} className="source-chip static" title={`${FACT_KEY_LABEL[f.key as FactKey] ?? f.key}: ${f.value}`}>
                                  {f.ref}: {FACT_KEY_LABEL[f.key as FactKey] ?? f.key} = {f.value}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
              </section>
            ))
          )}
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 12 }}>
            Added {fmtDateTime(doc.createdAt)} · sha256 {doc.sha256.slice(0, 16)}…
          </p>
        </>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- calculation viewer

export function CalcViewer({ calcRef, onClose }: { calcRef: string | null; onClose: () => void }) {
  const { state, actions } = useWs();
  const c = state.calculations.find((x) => x.ref === calcRef);
  return (
    <Dialog open={!!calcRef} onClose={onClose} title={c ? `${c.ref} · ${c.label}` : 'Calculation'} footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      {c ? (
        <div className="stack">
          <p className="formula">{c.formula}</p>
          <p>
            Result: <strong className="num">{c.display}</strong> {c.status === 'superseded' ? <StatusChip status="superseded" /> : null}
          </p>
          <div>
            <strong>Inputs</strong>{' '}
            {c.inputFactRefs.map((r) => (
              <SourceChip key={r} refId={r} onOpen={(x) => { onClose(); actions.openSource(x); }} />
            ))}
          </div>
          {c.assumptions.length ? (
            <div>
              <strong>Assumptions</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: '1.1em' }}>
                {c.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {c.caveat ? <div className="banner banner-warn">{c.caveat}</div> : null}
          <p className="muted" style={{ fontSize: '0.84rem' }}>
            Calculated by deterministic code (exact decimals), not by the language model. CBM = cubic metres; chargeable volume is what the carrier’s terms say may be billed, which can differ from physical volume.
          </p>
        </div>
      ) : (
        <p>Calculation not found.</p>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- fact correction

export function CorrectFactDialog({ factRef, onClose }: { factRef: string | null; onClose: () => void }) {
  const { state, actions } = useWs();
  const f = state.facts.find((x) => x.ref === factRef);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<ApiFail | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (f) {
      setValue(f.value);
      setNote('');
      setError(null);
    }
  }, [f?.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!f) return;
    setBusy(true);
    const res = await api(`/api/cases/${state.case.id}/facts/${f.ref}`, { method: 'PATCH', body: JSON.stringify({ value, note, expectedRevision: state.case.revision }) });
    setBusy(false);
    if (res.ok) {
      onClose();
      await actions.refetch();
    } else setError(res.error);
  }
  return (
    <Dialog
      open={!!factRef}
      onClose={onClose}
      title="Correct an extracted value"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !value.trim() || value === f?.value} onClick={save}>
            {busy ? 'Saving…' : 'Save correction'}
          </button>
        </>
      }
    >
      {f ? (
        <div>
          <p>
            <strong>{FACT_KEY_LABEL[f.key as FactKey] ?? f.key}</strong> <SourceChip refId={f.ref} />
          </p>
          {f.quote ? (
            <blockquote style={{ margin: '0 0 12px', padding: '6px 12px', borderLeft: '3px solid var(--border-strong)' }} className="muted">
              “{f.quote}”
            </blockquote>
          ) : null}
          <p className="muted" style={{ fontSize: '0.88rem' }}>
            The original extraction is kept. Your correction is recorded as a new, <strong>user-corrected</strong> value, and the case is reassessed.
          </p>
          <div className="field">
            <label htmlFor="fv">Correct value {f.unit ? `(${f.unit})` : ''}</label>
            <input id="fv" type="text" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" />
          </div>
          <div className="field">
            <label htmlFor="fn">Why (optional note)</label>
            <textarea id="fn" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? (
            <p role="alert" className="error-text">
              {error.message}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------- manual entry

const MANUAL_KEYS: { key: string; label: string; currency?: boolean; unit?: string }[] = [
  { key: 'billed_volume_cbm', label: 'Billed volume (CBM)', unit: 'CBM' },
  { key: 'declared_volume_cbm', label: 'Packing-list / declared volume (CBM)', unit: 'CBM' },
  { key: 'measured_volume_cbm', label: 'Measured volume (CBM)', unit: 'CBM' },
  { key: 'rate_per_cbm', label: 'Rate per CBM', currency: true },
  { key: 'billed_freight_amount', label: 'Billed freight amount', currency: true },
  { key: 'minimum_chargeable_cbm', label: 'Contractual minimum volume (CBM)', unit: 'CBM' },
];

export function ManualEntryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useWs();
  const [key, setKey] = useState(MANUAL_KEYS[0].key);
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState(state.case.currency || 'NGN');
  const [error, setError] = useState<ApiFail | null>(null);
  const [busy, setBusy] = useState(false);
  const spec = MANUAL_KEYS.find((k) => k.key === key)!;
  async function save() {
    setBusy(true);
    setError(null);
    const res = await api(`/api/cases/${state.case.id}/facts`, { method: 'POST', body: JSON.stringify({ key, value, unit: spec.unit ?? null, currency: spec.currency ? currency : null, note: 'Entered by hand' }) });
    setBusy(false);
    if (res.ok) {
      setValue('');
      await actions.refetch();
      onClose();
    } else setError(res.error);
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Enter a figure by hand"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !value.trim()} onClick={save}>
            {busy ? 'Saving…' : 'Add figure'}
          </button>
        </>
      }
    >
      <p className="muted">Use this when a document could not be read. The figure is recorded as <strong>your statement</strong>, not as a verified fact, and results stay provisional until a document backs it.</p>
      <div className="field">
        <label htmlFor="mk">What is it?</label>
        <select id="mk" value={key} onChange={(e) => setKey(e.target.value)}>
          {MANUAL_KEYS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="mv">Value</label>
          <input id="mv" type="text" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        {spec.currency ? (
          <div className="field">
            <label htmlFor="mc">Currency</label>
            <input id="mc" type="text" value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
          </div>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="error-text">
          {error.message}
        </p>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------- challenge

export function ChallengeDialog({ findingRef, onClose }: { findingRef: string | null; onClose: () => void }) {
  const { state, actions } = useWs();
  const f = state.findings.find((x) => x.ref === findingRef);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<ApiFail | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReason('');
    setError(null);
  }, [findingRef]);
  async function send() {
    if (!f) return;
    setBusy(true);
    const res = await api(`/api/cases/${state.case.id}/findings/${f.ref}/challenge`, { method: 'POST', body: JSON.stringify({ reason, expectedRevision: state.case.revision }) });
    setBusy(false);
    if (res.ok) {
      onClose();
      await actions.refetch();
    } else setError(res.error);
  }
  return (
    <Dialog
      open={!!findingRef}
      onClose={onClose}
      title="Challenge this finding"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || reason.trim().length < 5} onClick={send}>
            {busy ? 'Sending…' : 'Send challenge'}
          </button>
        </>
      }
    >
      {f ? (
        <>
          <p>
            <SourceChip refId={f.ref} /> <strong>{f.title}</strong>
          </p>
          <p className="muted">Your reason is recorded as your statement and sent to the Contract and Case agents, who reassess. To attach a supporting file, add it as evidence first.</p>
          <div className="field">
            <label htmlFor="ch">Why do you disagree?</label>
            <textarea id="ch" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          {error ? (
            <p role="alert" className="error-text">
              {error.message}
            </p>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------- questions

export function QuestionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useWs();
  const open_ = state.questions.filter((q) => q.status === 'open');
  const user = open_.filter((q) => q.audience === 'user');
  const carrier = open_.filter((q) => q.audience === 'carrier');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiFail | null>(null);

  async function submit(ref: string, dontKnow: boolean) {
    setBusy(ref);
    setError(null);
    const res = await api(`/api/cases/${state.case.id}/questions/${ref}/answer`, { method: 'POST', body: JSON.stringify({ answer: answers[ref] ?? '', dontKnow }) });
    setBusy(null);
    if (res.ok) await actions.refetch();
    else setError(res.error);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Questions" wide footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <h3>Questions for you</h3>
      {user.length === 0 ? <p className="muted">Nothing is waiting on you.</p> : null}
      {user.map((q) => (
        <div key={q.ref} className="card" style={{ marginBottom: 10 }}>
          <p style={{ margin: 0 }}>
            <strong>{q.prompt}</strong>
          </p>
          <p className="muted" style={{ margin: '2px 0 8px', fontSize: '0.86rem' }}>
            {q.reason}
          </p>
          <div className="field">
            <label htmlFor={`a-${q.ref}`} className="sr-only">
              Your answer to {q.ref}
            </label>
            <textarea id={`a-${q.ref}`} value={answers[q.ref] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.ref]: e.target.value })} placeholder="Your answer. This is recorded as your statement, not a verified fact." />
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy === q.ref || !(answers[q.ref] ?? '').trim()} onClick={() => submit(q.ref, false)}>
              Enter answer
            </button>
            <button type="button" className="btn btn-sm" onClick={actions.openAddEvidence}>
              Upload supporting file
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy === q.ref} onClick={() => submit(q.ref, true)}>
              I don’t know
            </button>
          </div>
        </div>
      ))}
      {error ? (
        <p role="alert" className="error-text">
          {error.message}
        </p>
      ) : null}
      <h3 style={{ marginTop: 16 }}>Questions for the freight company</h3>
      <p className="muted" style={{ fontSize: '0.88rem' }}>
        These go into the “Specific requests” part of the letter.
      </p>
      {carrier.length === 0 ? <p className="muted">None yet.</p> : <ul>{carrier.map((q) => <li key={q.ref}>{q.prompt}</li>)}</ul>}
    </Dialog>
  );
}

// ---------------------------------------------------------------- add evidence

export function AddEvidenceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions, isDemo } = useWs();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind | ''>('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      setBusy(true);
      setMsg([]);
      const out: { ok: boolean; text: string }[] = [];
      for (const f of Array.from(files)) {
        const body = new FormData();
        body.append('file', f);
        if (kind) body.append('kind', kind);
        const res = await api(`/api/cases/${state.case.id}/documents`, { method: 'POST', body });
        out.push(res.ok ? { ok: true, text: `${f.name} uploaded. It will be read and the case reassessed.` } : { ok: false, text: `${f.name}: ${res.error.message}` });
      }
      setMsg(out);
      setBusy(false);
      await actions.refetch();
    },
    [kind, state.case.id, actions],
  );

  return (
    <Dialog open={open} onClose={onClose} title="Add evidence" footer={<button type="button" className="btn" onClick={onClose}>Close</button>}>
      {isDemo ? (
        <p>
          Sample cases take the published evidence offered on the Overview tab, so the demonstration stays tied to the public report. Create an account to upload your own documents.
        </p>
      ) : (
        <>
          <p className="muted">New evidence is read by the Evidence Agent. Only the agents it affects reassess, and the letter is revised with the reason shown.</p>
          <div className="field">
            <label htmlFor="ae-kind">Document type (optional, detected automatically)</label>
            <select id="ae-kind" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
              <option value="">Detect automatically</option>
              {DOCUMENT_KINDS.filter((k) => k !== 'user_statement').map((k) => (
                <option key={k} value={k}>
                  {DOCUMENT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <input ref={input} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.eml,.txt" className="sr-only" id="ae-file" onChange={(e) => upload(e.target.files)} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : 'Choose files'}
          </button>
          <p className="muted" style={{ fontSize: '0.84rem' }}>
            PDF, PNG, JPG, .eml or .txt · 15 MB each. Photos and scans need their key figures entered by hand.
          </p>
          {msg.map((m, i) => (
            <p key={i} role={m.ok ? 'status' : 'alert'} className={m.ok ? 'muted' : 'error-text'}>
              {m.text}
            </p>
          ))}
        </>
      )}
    </Dialog>
  );
}

export { ReconBadge };
