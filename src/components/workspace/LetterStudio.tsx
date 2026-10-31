'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { diffLines, letterPlainText, NOT_VERIFIED_NOTE, type LetterSectionData } from '@/domain/letter';
import { api, fmtBytes, fmtDateTime, SourceChip, StatusChip, type ApiFail } from '../ui';
import { useWs } from './context';

interface ExportItem {
  id: string;
  kind: string;
  filename: string;
  draftVersion: number;
  evidenceRevision: number;
  sizeBytes: number;
  createdAt: string;
}

const BODY_EDITABLE = ['sender', 'recipient', 'subject', 'concern', 'comparison', 'uncertainty', 'requests', 'response', 'annex', 'closing'];

export function LetterStudio() {
  const { state, actions, base, isDemo } = useWs();
  const draft = state.draft;
  const sections = useMemo(() => (draft?.sections ?? []) as LetterSectionData[], [draft?.sections]);
  const proposal = state.proposal;
  const proposalSections = (proposal?.sections ?? []) as LetterSectionData[];
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [active, setActive] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [conflict, setConflict] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, 'accept' | 'keep'>>({});
  const [showDiff, setShowDiff] = useState<Record<string, boolean>>({});
  const [reviewed, setReviewed] = useState(false);
  const [exportErr, setExportErr] = useState<ApiFail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setEdits({});
    setConflict(false);
  }, [draft?.version]);

  const exports = (state.exports as unknown as ExportItem[]) ?? [];
  const currentExports = exports.filter((e) => draft && e.draftVersion === draft.version && e.evidenceRevision === state.case.revision);
  const exportedCurrent = currentExports.length > 0;

  const status = proposal || state.stale.draft ? 'Review required' : exportedCurrent ? 'Exported' : draft && draft.createdBy === 'agent' && draft.version > 1 && draft.changeSummary && state.drafts.filter((d) => d.status !== 'proposed' && d.status !== 'rejected').length > 1 ? 'Updated because evidence changed' : 'Draft';

  async function save(id: string) {
    if (!draft || edits[id] === undefined) return;
    const text = edits[id];
    if (text === sections.find((s) => s.id === id)?.text) return;
    setSaveState('saving');
    const res = await api(`/api/cases/${state.case.id}/letter`, { method: 'PATCH', body: JSON.stringify({ baseVersion: draft.version, sections: { [id]: text } }) });
    if (res.ok) {
      setSaveState('saved');
      await actions.refetch();
    } else {
      setSaveState('error');
      if (res.error.code === 'version_conflict') setConflict(true);
    }
  }

  const textOf = (s: LetterSectionData) => edits[s.id] ?? s.text;
  const plain = useMemo(() => letterPlainText(sections.map((s) => ({ ...s, text: edits[s.id] ?? s.text }))), [sections, edits]);

  async function applyDecisions() {
    if (!proposal) return;
    setBusy('reconcile');
    const res = await api(`/api/cases/${state.case.id}/letter/reconcile`, { method: 'POST', body: JSON.stringify({ proposalVersion: proposal.version, decisions }) });
    setBusy(null);
    if (res.ok) {
      setDecisions({});
      await actions.refetch();
    } else setExportErr(res.error);
  }

  async function makePack(): Promise<ExportItem[] | null> {
    if (currentExports.length >= 2) return currentExports;
    setExportErr(null);
    const res = await api<{ exports: { id: string; kind: string; filename: string }[] }>(`/api/cases/${state.case.id}/exports`, { method: 'POST', body: JSON.stringify({ reviewed }) });
    if (!res.ok) {
      setExportErr(res.error);
      return null;
    }
    await actions.refetch();
    return res.data.exports as unknown as ExportItem[];
  }

  function download(id: string) {
    const a = document.createElement('a');
    a.href = `/api/cases/${state.case.id}/exports/${id}`;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function get(kind: 'complaint_pdf' | 'evidence_summary_pdf' | 'discrepancies_csv') {
    setBusy(kind);
    const pack = await makePack();
    setBusy(null);
    const item = pack?.find((e) => e.kind === kind);
    if (item) {
      download(item.id);
      setDone(true);
    }
  }

  async function showPreview() {
    setBusy('preview');
    const pack = await makePack();
    setBusy(null);
    const item = pack?.find((e) => e.kind === 'complaint_pdf');
    if (item) setPreview(`/api/cases/${state.case.id}/exports/${item.id}?inline=1`);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setExportErr({ code: 'clipboard', message: 'Copying was blocked by the browser. Select the text and copy it manually.' });
    }
  }

  if (!draft) {
    return (
      <div className="card">
        <h2>Letter</h2>
        <p className="muted" style={{ marginBottom: 0 }}>
          {state.activeRun ? 'The Drafting Agent writes the letter once the Case Agent has a sourced assessment. It will appear here.' : 'No letter yet. The letter is drafted from the case assessment after an investigation.'}
        </p>
        {state.readiness.ready === false ? <div className="banner banner-warn" style={{ marginTop: 12 }}>{state.readiness.message}</div> : null}
      </div>
    );
  }

  const active_ = sections.find((s) => s.id === active);
  const lastNote = draft.changeSummary;

  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2 style={{ margin: 0 }}>Complaint letter</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: '0.88rem' }}>
            Draft v{draft.version} · evidence revision {draft.evidenceRevision} · {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'All changes saved'}
          </p>
        </div>
        <span className={`chip ${status === 'Review required' ? 'chip-warn' : status === 'Exported' ? 'chip-good' : status.startsWith('Updated') ? 'chip-info' : 'chip-plain'}`} role="status">
          {status}
        </span>
      </div>

      {state.stale.draft ? (
        <div className="banner banner-warn" role="status">
          <strong>This draft is stale.</strong> Evidence changed after it was written (draft: revision {draft.evidenceRevision}, case: revision {state.case.revision}).{' '}
          {state.activeRun ? 'A reassessment is running; the Drafting Agent will propose updates.' : 'Download only after reviewing what changed.'}
        </div>
      ) : null}
      {lastNote && draft.createdBy === 'agent' && draft.version > 1 ? (
        <div className="change-banner">
          <strong>What changed in this version:</strong> {lastNote}
        </div>
      ) : null}
      {conflict ? (
        <div className="banner banner-bad" role="alert">
          The letter changed since you opened it, so your edit was not saved over the newer version.{' '}
          <button type="button" className="btn btn-sm" onClick={() => { setEdits({}); setConflict(false); void actions.refetch(); }}>
            Reload the latest
          </button>
        </div>
      ) : null}

      {proposal ? (
        <section className="card" style={{ borderColor: 'var(--warn)' }} aria-labelledby="rec-h">
          <h3 id="rec-h">Proposed updates to sections you edited</h3>
          <p className="muted">
            New evidence changed the analysis. Your wording has not been touched. For each section choose whether to take the proposed text or keep yours. Changes marked in green are proposed; red lines would be removed.
          </p>
          {proposalSections.map((p) => {
            const mine = sections.find((s) => s.id === p.id);
            const lines = diffLines(mine?.text ?? '', p.text);
            return (
              <div key={p.id} className="card" style={{ marginBottom: 10 }}>
                <div className="row-between">
                  <strong>{p.title}</strong>
                  <button type="button" className="btn btn-sm btn-ghost" aria-expanded={showDiff[p.id] !== false} onClick={() => setShowDiff({ ...showDiff, [p.id]: showDiff[p.id] === false })}>
                    {showDiff[p.id] === false ? 'Review differences' : 'Hide differences'}
                  </button>
                </div>
                {showDiff[p.id] !== false ? (
                  <div style={{ margin: '8px 0' }} aria-label={`Differences for ${p.title}`}>
                    {lines.map((l, i) => (
                      <div key={i} className={`diff-line ${l.type === 'add' ? 'diff-add' : l.type === 'remove' ? 'diff-remove' : ''}`}>
                        <span className="sr-only">{l.type === 'add' ? 'Added: ' : l.type === 'remove' ? 'Removed: ' : ''}</span>
                        {l.text || ' '}
                      </div>
                    ))}
                  </div>
                ) : null}
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="sr-only">Decision for {p.title}</legend>
                  <div className="row">
                    <button type="button" className={`btn btn-sm ${decisions[p.id] === 'accept' ? 'btn-primary' : ''}`} aria-pressed={decisions[p.id] === 'accept'} onClick={() => setDecisions({ ...decisions, [p.id]: 'accept' })}>
                      Accept proposed update
                    </button>
                    <button type="button" className={`btn btn-sm ${decisions[p.id] === 'keep' ? 'btn-primary' : ''}`} aria-pressed={decisions[p.id] === 'keep'} onClick={() => setDecisions({ ...decisions, [p.id]: 'keep' })}>
                      Keep my wording
                    </button>
                  </div>
                </fieldset>
              </div>
            );
          })}
          <button type="button" className="btn btn-primary" disabled={busy === 'reconcile' || proposalSections.some((p) => !decisions[p.id])} onClick={applyDecisions}>
            {busy === 'reconcile' ? 'Applying…' : 'Apply my decisions'}
          </button>
        </section>
      ) : null}

      <div className="letter-grid">
        <div className="paper" aria-label="Letter editor">
          {sections.map((s) => {
            const editable = BODY_EDITABLE.includes(s.id);
            return (
              <div key={s.id} className="letter-section">
                <div className="tag">
                  <span>{s.title}</span>
                  {s.userEdited ? <span className="chip chip-warn chip-plain" title={NOT_VERIFIED_NOTE}>Edited by you · not verified by Counterbill</span> : null}
                  {s.refs.length ? <span style={{ textTransform: 'none', letterSpacing: 0 }}>{s.refs.length} source{s.refs.length === 1 ? '' : 's'}</span> : null}
                </div>
                <label htmlFor={`ls-${s.id}`} className="sr-only">
                  {s.title}
                </label>
                <textarea
                  id={`ls-${s.id}`}
                  value={textOf(s)}
                  rows={Math.max(2, Math.min(14, textOf(s).split('\n').reduce((n, l) => n + Math.ceil(l.length / 78) || 1, 0)))}
                  readOnly={!editable}
                  onFocus={() => setActive(s.id)}
                  onChange={(e) => setEdits({ ...edits, [s.id]: e.target.value })}
                  onBlur={() => save(s.id)}
                />
              </div>
            );
          })}
        </div>

        <aside className="stack" aria-label="Evidence and claims">
          <div className="card col-sticky">
            <h3 style={{ fontSize: '1rem' }}>Evidence and claims</h3>
            {active_ ? (
              <>
                <p style={{ marginBottom: 6 }}>
                  <strong>{active_.title}</strong>
                </p>
                {active_.userEdited ? (
                  <div className="banner banner-warn" style={{ marginBottom: 8 }}>
                    {NOT_VERIFIED_NOTE} Your wording is kept. The references below belong to the agent’s version.
                  </div>
                ) : null}
                {active_.refs.length ? (
                  <div className="row" style={{ marginBottom: 8 }}>
                    {active_.refs.map((r) => (
                      <SourceChip key={r} refId={r} onOpen={actions.openSource} />
                    ))}
                  </div>
                ) : (
                  <p className="muted" style={{ fontSize: '0.88rem' }}>
                    This part is filled in from your case details, not from a claim about the evidence.
                  </p>
                )}
                {active_.userEdited && active_.agentText !== active_.text ? (
                  <details>
                    <summary>Agent’s version</summary>
                    <p className="muted" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--serif)' }}>
                      {active_.agentText}
                    </p>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="muted">Select a paragraph to see the findings and sources behind it. Unsupported text you add is allowed and is marked “not verified”.</p>
            )}
            <h3 style={{ fontSize: '0.95rem', marginTop: 16 }}>Versions</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.84rem' }}>
              {state.drafts.slice(0, 8).map((d) => (
                <li key={d.version} style={{ padding: '4px 0', borderTop: '1px solid var(--border)' }}>
                  <strong>v{d.version}</strong> · {d.createdBy} · {d.status} <span className="muted">· rev {d.evidenceRevision}</span>
                  {d.changeSummary ? <div className="muted">{d.changeSummary}</div> : null}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <section className="card" aria-labelledby="exp-h">
        <h3 id="exp-h">Review and export</h3>
        {isDemo ? (
          <div className="banner banner-info" style={{ marginBottom: 12 }}>
            This is a sample. The exported letter and evidence summary state that the invoice and packing list are reconstructed for demonstration.
          </div>
        ) : null}
        <label className="row" style={{ alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} style={{ width: 20, height: 20, marginTop: 3 }} />
          <span>I have reviewed the facts and understand this draft does not establish legal entitlement.</span>
        </label>
        <div className="row">
          <button type="button" className="btn btn-primary" disabled={!reviewed || !!busy} onClick={() => get('complaint_pdf')}>
            {busy === 'complaint_pdf' ? 'Preparing…' : 'Download PDF'}
          </button>
          <button type="button" className="btn" disabled={!reviewed || !!busy} onClick={() => get('evidence_summary_pdf')}>
            {busy === 'evidence_summary_pdf' ? 'Preparing…' : 'Download evidence summary'}
          </button>
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied' : 'Copy text'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={!reviewed || !!busy} onClick={() => get('discrepancies_csv')}>
            Discrepancies (CSV)
          </button>
          <button type="button" className="btn btn-ghost" disabled={!reviewed || !!busy} onClick={showPreview}>
            Preview PDF
          </button>
        </div>
        <p className="muted" style={{ fontSize: '0.84rem', marginBottom: 0 }}>
          There is no send button on purpose: you review the letter and send it yourself. Exports never include your uploaded documents. Source documents can contain names, addresses and payment details, so review who receives the pack before sharing it.
        </p>
        {exportErr ? (
          <p role="alert" className="error-text">
            {exportErr.message}
          </p>
        ) : null}
        <span className="sr-only" role="status">
          {copied ? 'Letter text copied to clipboard' : ''}
        </span>
        {done ? (
          <div className="banner banner-good" role="status" style={{ marginTop: 12 }}>
            <strong>Your case pack is ready.</strong> Review who receives it before sharing. <Link href={base}>Back to case</Link> · <Link href={isDemo ? '/demo' : '/app/new'}>{isDemo ? 'Other sample cases' : 'New case'}</Link>
          </div>
        ) : null}
        {preview ? (
          <div style={{ marginTop: 12 }}>
            <iframe title="Letter PDF preview" src={preview} style={{ width: '100%', height: 640, border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
          </div>
        ) : null}
        {exports.length ? (
          <>
            <h4 style={{ margin: '16px 0 6px' }}>Saved versions</h4>
            <div className="table-wrap">
              <table className="t stackable">
                <caption className="sr-only">Exports saved in this case</caption>
                <thead>
                  <tr>
                    <th scope="col">File</th>
                    <th scope="col">Built from</th>
                    <th scope="col">Size</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {exports.slice(0, 9).map((e) => (
                    <tr key={e.id}>
                      <td data-label="File">
                        <a href={`/api/cases/${state.case.id}/exports/${e.id}`} download>
                          {e.filename}
                        </a>
                      </td>
                      <td data-label="Built from">
                        draft v{e.draftVersion} · evidence rev {e.evidenceRevision} · {fmtDateTime(e.createdAt)}
                      </td>
                      <td data-label="Size" className="num">
                        {fmtBytes(e.sizeBytes)}
                      </td>
                      <td data-label="Status">{e.evidenceRevision < state.case.revision ? <StatusChip status="needs_input" label="Stale: evidence changed since" /> : <StatusChip status="ready" label="Current" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
