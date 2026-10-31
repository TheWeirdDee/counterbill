'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DOCUMENT_KINDS, DOCUMENT_KIND_LABEL, type DocumentKind } from '@/domain/schemas';
import { api, fmtBytes, StatusChip, type ApiFail } from './ui';

interface LocalFile {
  localId: string;
  name: string;
  size: number;
  state: 'uploading' | 'uploaded' | 'rejected';
  message?: string;
  ref?: string;
  kind?: DocumentKind;
  parse?: string;
  parseNote?: string | null;
}

const EMPTY = { name: '', claimant: '', counterparty: '', origin: '', destination: '', shipmentClass: 'unknown', currency: 'NGN', billedAmount: '', quoteCurrency: '', concern: '' };

export function NewCaseWizard() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState(EMPTY);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [error, setError] = useState<ApiFail | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), [step]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function continueToEvidence() {
    setError(null);
    setFieldErrors({});
    if (!form.name.trim()) {
      setFieldErrors({ name: 'Give the case a name so you can find it later.' });
      return;
    }
    setBusy(true);
    if (caseId) {
      setStep(2);
      setBusy(false);
      return;
    }
    const res = await api<{ caseId: string }>('/api/cases', { method: 'POST', body: JSON.stringify(form) });
    setBusy(false);
    if (res.ok) {
      setCaseId(res.data.caseId);
      setStep(2);
    } else setError(res.error);
  }

  const refreshDocs = useCallback(async () => {
    if (!caseId) return;
    const res = await api<{ documents: { ref: string; originalFilename: string; kind: DocumentKind; parseStatus: string; parseError: string | null; sourceClass: string }[] }>(`/api/cases/${caseId}/documents`);
    if (!res.ok) return;
    setFiles((cur) =>
      cur.map((f) => {
        const d = res.data.documents.find((x) => x.ref === f.ref);
        return d ? { ...f, parse: d.parseStatus, parseNote: d.parseError, kind: d.kind } : f;
      }),
    );
  }, [caseId]);

  useEffect(() => {
    if (!files.some((f) => f.state === 'uploaded' && f.parse !== 'ready' && f.parse !== 'failed' && f.parse !== 'needs_manual_review')) return;
    const t = setInterval(refreshDocs, 1500);
    return () => clearInterval(t);
  }, [files, refreshDocs]);

  async function upload(list: FileList | File[]) {
    if (!caseId) return;
    for (const file of Array.from(list)) {
      const localId = Math.random().toString(36).slice(2);
      setFiles((f) => [...f, { localId, name: file.name, size: file.size, state: 'uploading' }]);
      const body = new FormData();
      body.append('file', file);
      const res = await api<{ documents: { ref: string; kind: DocumentKind; parseStatus: string }[] }>(`/api/cases/${caseId}/documents`, { method: 'POST', body });
      setFiles((f) =>
        f.map((x) =>
          x.localId !== localId
            ? x
            : res.ok
              ? { ...x, state: 'uploaded', ref: res.data.documents[0].ref, kind: res.data.documents[0].kind, parse: res.data.documents[0].parseStatus }
              : { ...x, state: 'rejected', message: res.error.message },
        ),
      );
    }
  }

  async function changeKind(f: LocalFile, kind: DocumentKind) {
    setFiles((cur) => cur.map((x) => (x.localId === f.localId ? { ...x, kind } : x)));
    if (caseId && f.ref) await api(`/api/cases/${caseId}/documents/${f.ref}`, { method: 'PATCH', body: JSON.stringify({ kind }) });
  }

  const usable = files.filter((f) => f.state === 'uploaded').length;
  const canStart = usable > 0 || form.concern.trim().length > 0;

  async function start() {
    if (!caseId) return;
    setBusy(true);
    setError(null);
    const res = await api(`/api/cases/${caseId}/start`, { method: 'POST' });
    if (res.ok) router.push(`/app/cases/${caseId}`);
    else {
      setError(res.error);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820 }}>
      <p className="eyebrow">Step {step} of 3</p>
      <h1 ref={headingRef} tabIndex={-1} style={{ fontSize: '1.7rem' }}>
        {step === 1 ? 'Shipment basics' : step === 2 ? 'Add evidence' : 'Confirm and investigate'}
      </h1>

      {step === 1 ? (
        <div className="card">
          <p className="muted">Everything except the case name is optional. Unknown fields can stay empty.</p>
          <div className="field">
            <label htmlFor="c-name">Case name</label>
            <input id="c-name" type="text" value={form.name} onChange={set('name')} required aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? 'c-name-err' : undefined} placeholder="e.g. March LCL shipment — volume charge" />
            {fieldErrors.name ? (
              <span className="error-text" id="c-name-err" role="alert">
                {fieldErrors.name}
              </span>
            ) : null}
          </div>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="c-claimant">Your company</label>
              <input id="c-claimant" type="text" value={form.claimant} onChange={set('claimant')} autoComplete="organization" />
            </div>
            <div className="field">
              <label htmlFor="c-cp">Freight company (other party)</label>
              <input id="c-cp" type="text" value={form.counterparty} onChange={set('counterparty')} />
            </div>
            <div className="field">
              <label htmlFor="c-origin">Origin</label>
              <input id="c-origin" type="text" value={form.origin} onChange={set('origin')} placeholder="e.g. Guangzhou, China" />
            </div>
            <div className="field">
              <label htmlFor="c-dest">Destination</label>
              <input id="c-dest" type="text" value={form.destination} onChange={set('destination')} placeholder="e.g. Lagos" />
            </div>
            <div className="field">
              <label htmlFor="c-class">Shipment type</label>
              <select id="c-class" value={form.shipmentClass} onChange={set('shipmentClass')}>
                {['LCL', 'FCL', 'air', 'other', 'unknown'].map((c) => (
                  <option key={c} value={c}>
                    {c === 'unknown' ? 'Not sure' : c}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="c-cur">Invoice currency</label>
              <input id="c-cur" type="text" value={form.currency} onChange={set('currency')} maxLength={3} aria-describedby="c-cur-h" />
              <span className="hint" id="c-cur-h">
                Three letters, e.g. NGN or USD. Amounts in different currencies are never compared without a dated rate.
              </span>
            </div>
            <div className="field">
              <label htmlFor="c-amt">Billed amount, if known</label>
              <input id="c-amt" type="text" inputMode="decimal" value={form.billedAmount} onChange={set('billedAmount')} />
            </div>
            <div className="field">
              <label htmlFor="c-qcur">Quote currency, if different</label>
              <input id="c-qcur" type="text" value={form.quoteCurrency} onChange={set('quoteCurrency')} maxLength={3} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="c-concern">What is your concern?</label>
            <textarea id="c-concern" value={form.concern} onChange={set('concern')} placeholder="The invoice uses 1.10 CBM, but my packing list says 0.55 CBM." />
            <span className="hint">Written in your own words. It is treated as your statement, not as a verified fact.</span>
          </div>
          {error ? (
            <p role="alert" className="error-text">
              {error.message}
            </p>
          ) : null}
          <button type="button" className="btn btn-primary" onClick={continueToEvidence} disabled={busy}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="stack">
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void upload(e.dataTransfer.files);
            }}
          >
            <p style={{ margin: '0 0 8px' }}>
              <strong>Drag files here</strong>, or
            </p>
            <input ref={inputRef} id="file-input" aria-label="Choose files to upload" tabIndex={-1} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.eml,.txt" className="sr-only" onChange={(e) => e.target.files && upload(e.target.files)} />
            <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
              Browse files
            </button>
            <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.86rem' }}>
              PDF, PNG, JPG, .eml or .txt · up to 15 MB each · 10 files · 50 MB per case
            </p>
          </div>
          <div className="banner banner-info">
            <strong>Privacy.</strong> Uploaded documents are stored privately for your account and may be processed by the AI model provider configured for this deployment to investigate your case. Documents can contain names, addresses and payment details.
            <br />
            <strong>Scan quality.</strong> Text-based PDFs work best. Photos and scans are not read automatically here: you will be asked to type the key figures.
          </div>
          {files.length ? (
            <div className="table-wrap">
              <table className="t stackable">
                <caption className="sr-only">Uploaded files</caption>
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Size</th>
                    <th scope="col">Status</th>
                    <th scope="col">Document type</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.localId}>
                      <td data-label="File" style={{ overflowWrap: 'anywhere' }}>
                        {f.name}
                      </td>
                      <td data-label="Size" className="num">
                        {fmtBytes(f.size)}
                      </td>
                      <td data-label="Status">
                        {f.state === 'uploading' ? (
                          <StatusChip status="uploaded" label="Uploading" />
                        ) : f.state === 'rejected' ? (
                          <span className="error-text" role="alert">
                            {f.message}
                          </span>
                        ) : (
                          <>
                            <StatusChip status={f.parse ?? 'queued'} />
                            {f.parseNote && f.parse !== 'ready' ? <div className="muted" style={{ fontSize: '0.8rem' }}>{f.parseNote}</div> : null}
                          </>
                        )}
                      </td>
                      <td data-label="Type">
                        {f.state === 'uploaded' ? (
                          <>
                            <label className="sr-only" htmlFor={`k-${f.localId}`}>
                              Document type for {f.name}
                            </label>
                            <select id={`k-${f.localId}`} value={f.kind} onChange={(e) => changeKind(f, e.target.value as DocumentKind)}>
                              {DOCUMENT_KINDS.filter((k) => k !== 'user_statement').map((k) => (
                                <option key={k} value={k}>
                                  {DOCUMENT_KIND_LABEL[k]}
                                </option>
                              ))}
                            </select>
                          </>
                        ) : null}
                      </td>
                      <td data-label="">
                        {f.state === 'rejected' ? (
                          <button type="button" className="btn btn-sm" onClick={() => setFiles((c) => c.filter((x) => x.localId !== f.localId))}>
                            Dismiss
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No files yet. You can also continue with just your description and add documents later.</p>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep(3)}>
              Continue
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="stack">
          <div className="card">
            <h2>Review</h2>
            <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 30%) 1fr', gap: '6px 12px', margin: 0 }}>
              {([
                ['Case', form.name],
                ['Your company', form.claimant],
                ['Freight company', form.counterparty],
                ['Route', form.origin || form.destination ? `${form.origin || '?'} → ${form.destination || '?'}` : ''],
                ['Shipment type', form.shipmentClass === 'unknown' ? '' : form.shipmentClass],
                ['Billed amount', form.billedAmount ? `${form.currency} ${form.billedAmount}` : ''],
                ['Your concern', form.concern],
              ] as const).map(([k, v]) => (
                <div key={k} style={{ display: 'contents' }}>
                  <dt className="muted">{k}</dt>
                  <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{v || <span className="muted">Not provided</span>}</dd>
                </div>
              ))}
            </dl>
            <h3 style={{ marginTop: 16 }}>Files ({usable})</h3>
            {usable ? (
              <ul>
                {files.filter((f) => f.state === 'uploaded').map((f) => (
                  <li key={f.localId}>
                    {f.name} — {DOCUMENT_KIND_LABEL[f.kind ?? 'other']} <StatusChip status={f.parse ?? 'queued'} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No files. The investigation will work from your description and ask for what is missing.</p>
            )}
          </div>
          <div className="banner banner-info">
            Incomplete records give a <strong>provisional</strong> result with a list of what is missing. Nothing is invented to fill a gap.
          </div>
          {error ? (
            <div role="alert" className="banner banner-bad">
              <strong>{['missing_api_key', 'unsupported_model', 'test_mode_blocked'].includes(error.code) ? 'This server is not set up for live investigations.' : 'Could not start.'}</strong>
              <p style={{ margin: '4px 0 0' }}>{error.message}</p>
            </div>
          ) : null}
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep(2)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" onClick={start} disabled={busy || !canStart}>
              {busy ? 'Starting…' : 'Start investigation'}
            </button>
            {!canStart ? <span className="muted">Add a document or describe your concern first.</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
