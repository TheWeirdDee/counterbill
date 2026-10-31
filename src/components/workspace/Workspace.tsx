'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { refKind } from '@/domain/citations';
import { api, Dialog, Skeleton, StatusChip, ReconBadge } from '../ui';
import { ActivityView } from './ActivityView';
import { WsProvider, useWs, type WsActions } from './context';
import { AddEvidenceDialog, CalcViewer, ChallengeDialog, CorrectFactDialog, DocumentViewer, ManualEntryDialog, QuestionsDialog } from './Dialogs';
import { LetterStudio } from './LetterStudio';
import { ActivityRail, Canvas, EvidenceNavigator } from './Overview';
import { useCaseState } from './useCaseState';
import { EvidenceView, FindingsView, TimelineView } from './Views';

const TABS = [
  { id: '', label: 'Overview' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'findings', label: 'Findings' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'letter', label: 'Letter' },
  { id: 'activity', label: 'Activity' },
] as const;

export function Workspace({ caseId, tab, base, isDemo }: { caseId: string; tab: string; base: string; isDemo: boolean }) {
  const { state, error, events, connection, announcement, refetch } = useCaseState(caseId);
  const [viewer, setViewer] = useState<{ docRef: string | null; spanRef: string | null }>({ docRef: null, spanRef: null });
  const [calcRef, setCalcRef] = useState<string | null>(null);
  const [correctRef, setCorrectRef] = useState<string | null>(null);
  const [challengeRef, setChallengeRef] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [questions, setQuestions] = useState(false);
  const [adding, setAdding] = useState(false);
  const router = useRouter();
  const [options, setOptions] = useState(false);

  const actions: WsActions | null = useMemo(() => {
    if (!state) return null;
    return {
      refetch,
      openAddEvidence: () => setAdding(true),
      openChallenge: (r) => setChallengeRef(r),
      openCorrect: (r) => setCorrectRef(r),
      openManualEntry: () => setManual(true),
      openQuestions: () => setQuestions(true),
      openSource: (ref) => {
        const k = refKind(ref);
        if (k === 'document') setViewer({ docRef: ref, spanRef: null });
        else if (k === 'span') setViewer({ docRef: ref.split('-')[0], spanRef: ref });
        else if (k === 'fact') {
          const f = state.facts.find((x) => x.ref === ref);
          const span = f?.spanRefs[0];
          if (span) setViewer({ docRef: span.split('-')[0], spanRef: span });
          else setCorrectRef(ref);
        } else if (k === 'calculation') setCalcRef(ref);
        else if (k === 'finding') router.push(`${base}/findings`);
      },
    };
  }, [state, refetch, router, base]);

  if (error && !state) {
    return (
      <div className="page">
        <div className="card" role="alert" style={{ maxWidth: 560 }}>
          <h1 style={{ fontSize: '1.4rem' }}>{error.code === 'not_found' ? 'This case isn’t available' : error.code === 'unauthenticated' ? 'Please sign in' : 'We couldn’t load this case'}</h1>
          <p className="muted">
            {error.code === 'not_found'
              ? 'It may not exist, or it belongs to another account or browser. Nothing about it is shown here.'
              : error.code === 'unauthenticated'
                ? 'Sign in to see your cases.'
                : error.message}
          </p>
          <div className="row">
            {error.code === 'unauthenticated' ? (
              <Link className="btn btn-primary" href={`/login?next=${encodeURIComponent(base)}`}>
                Sign in
              </Link>
            ) : (
              <button className="btn btn-primary" onClick={() => location.reload()}>
                Try again
              </button>
            )}
            <Link className="btn" href={isDemo ? '/examples' : '/app'}>
              {isDemo ? 'Example cases' : 'Your cases'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!state || !actions) return <WorkspaceSkeleton />;

  const c = state.case;
  const partial = state.latestRun?.status === 'partial';
  const statusLabel =
    state.activeRun || c.status === 'processing'
      ? 'Investigating'
      : partial && (c.status === 'needs_input' || c.status === 'review_ready')
        ? 'Completed with limitations'
        : c.status === 'needs_input'
          ? 'Needs evidence'
          : c.status === 'review_ready'
            ? 'Ready to review'
            : c.status === 'failed'
              ? 'Needs attention'
              : c.status === 'draft'
                ? 'Not started'
                : c.status;
  const statusKey = state.activeRun ? 'processing' : c.status;
  const hasOpenUserQ = state.questions.some((q) => q.status === 'open' && q.audience === 'user');

  async function startNow() {
    await api(`/api/cases/${caseId}/start`, { method: 'POST' });
    await refetch();
  }

  return (
    <WsProvider value={{ state, events, connection, base, isDemo, actions }}>
      <div className="page" style={{ paddingTop: 16 }}>
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        <header className="ws-head">
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              {isDemo ? <span className="chip chip-info chip-plain">Example</span> : null}
              {c.sampleLabel ? <span className="chip chip-plain">{c.sampleLabel}</span> : null}
            </div>
            <h1>{c.name}</h1>
            <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
              {[c.origin && c.destination ? `${c.origin} → ${c.destination}` : null, `Case ID CB-${c.id.slice(0, 8).toUpperCase()}`, `evidence revision ${c.revision}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="row">
            <StatusChip status={statusKey} label={statusLabel} />
            {!isDemo ? (
              <button type="button" className="btn btn-sm" onClick={() => setOptions(true)}>
                Case options
              </button>
            ) : (
              <Link href={`/examples/${c.demoSlug}`} className="btn btn-sm">
                Start a fresh run
              </Link>
            )}
          </div>
        </header>

        {state.documents.some((d) => d.sourceClass === 'reconstructed_demo' || d.sourceClass === 'hypothetical_demo') ? (
          <p style={{ margin: '0 0 8px' }}>
            <ReconBadge>Contains reconstructed or hypothetical documents. They are labelled everywhere, including exports.</ReconBadge>
          </p>
        ) : null}

        <section className="summary-strip" aria-label="Key figures">
          {state.summary.map((s) => (
            <div key={s.label} className="cell">
              <div className="label">{s.label}</div>
              <div className={`value${s.value ? '' : ' unknown'}`}>
                {s.value ?? 'Not yet established'}
              </div>
              <div className="note">
                {s.note}{' '}
                {s.calcRef ? (
                  <button type="button" className="source-chip" onClick={() => actions.openSource(s.calcRef!)}>
                    {s.calcRef}
                  </button>
                ) : (
                  s.refs.slice(0, 1).map((r) => (
                    <button key={r} type="button" className="source-chip" onClick={() => actions.openSource(r)}>
                      {r}
                    </button>
                  ))
                )}
              </div>
            </div>
          ))}
        </section>
        <p className="caveat">A billing difference is not automatically a recoverable overcharge.</p>

        <nav className="tabs" aria-label="Case sections">
          {TABS.map((t) => {
            const href = t.id ? `${base}/${t.id}` : base;
            return (
              <Link key={t.id} href={href} aria-current={tab === t.id ? 'page' : undefined}>
                {t.label}
                {t.id === 'letter' && state.proposal ? ' •' : ''}
              </Link>
            );
          })}
        </nav>

        <div id="tab-content">
          {tab === '' ? (
            <OverviewColumns />
          ) : tab === 'evidence' ? (
            <EvidenceView />
          ) : tab === 'findings' ? (
            <FindingsView />
          ) : tab === 'timeline' ? (
            <TimelineView />
          ) : tab === 'letter' ? (
            <LetterStudio />
          ) : tab === 'activity' ? (
            <ActivityView />
          ) : (
            <div className="card">
              <p>That section doesn’t exist.</p>
              <Link href={base}>Back to the overview</Link>
            </div>
          )}
        </div>

        <div className="action-bar" role="toolbar" aria-label="Case actions">
          {c.status === 'draft' && !state.activeRun ? (
            <button type="button" className="btn btn-primary" onClick={startNow}>
              Start investigation
            </button>
          ) : null}
          <button type="button" className="btn" onClick={() => setAdding(true)} disabled={isDemo && !state.demo?.steps.some((s) => !s.added)}>
            Add evidence
          </button>
          <button type="button" className="btn" onClick={() => setQuestions(true)} disabled={!hasOpenUserQ}>
            Answer questions
          </button>
          {state.draft ? (
            <Link href={`${base}/letter`} className="btn btn-primary">
              Review letter
            </Link>
          ) : (
            <button type="button" className="btn" disabled>
              Review letter
            </button>
          )}
        </div>
      </div>

      <DocumentViewer docRef={viewer.docRef} spanRef={viewer.spanRef} onClose={() => setViewer({ docRef: null, spanRef: null })} />
      <CalcViewer calcRef={calcRef} onClose={() => setCalcRef(null)} />
      <CorrectFactDialog factRef={correctRef} onClose={() => setCorrectRef(null)} />
      <ChallengeDialog findingRef={challengeRef} onClose={() => setChallengeRef(null)} />
      <ManualEntryDialog open={manual} onClose={() => setManual(false)} />
      <QuestionsDialog open={questions} onClose={() => setQuestions(false)} />
      <AddEvidenceDialog open={adding} onClose={() => setAdding(false)} />
      <CaseOptions open={options} onClose={() => setOptions(false)} />
    </WsProvider>
  );
}

/** Three panes side by side on a wide screen; one pane at a time, chosen by a switcher, on a small one. */
function OverviewColumns() {
  const [pane, setPane] = useState<'findings' | 'evidence' | 'activity'>('findings');
  const panes = [
    { id: 'findings', label: 'Findings' },
    { id: 'evidence', label: 'Evidence' },
    { id: 'activity', label: 'Agents' },
  ] as const;
  return (
    <>
      <div className="pane-switch seg" role="group" aria-label="Overview section">
        {panes.map((p) => (
          <button key={p.id} type="button" aria-pressed={pane === p.id} onClick={() => setPane(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="three-col" data-pane={pane}>
        <div className="col-evidence">
          <EvidenceNavigator />
        </div>
        <div className="col-canvas">
          <Canvas />
        </div>
        <div className="col-activity">
          <ActivityRail />
        </div>
      </div>
    </>
  );
}

function CaseOptions({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state, actions } = useWs();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function archive() {
    setBusy(true);
    const res = await api(`/api/cases/${state.case.id}`, { method: 'PATCH', body: JSON.stringify({ expectedRevision: state.case.revision, archived: !state.case.archived }) });
    setBusy(false);
    if (res.ok) {
      onClose();
      await actions.refetch();
    } else setErr(res.error.message);
  }
  async function del() {
    setBusy(true);
    const res = await api(`/api/cases/${state.case.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/app');
    else {
      setErr(res.error.message);
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Case options" footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="stack">
        <div>
          <strong>{state.case.archived ? 'Unarchive' : 'Archive'} this case</strong>
          <p className="muted" style={{ margin: '2px 0 8px' }}>Archived cases move out of your main list. Nothing is deleted.</p>
          <button className="btn btn-sm" onClick={archive} disabled={busy}>
            {state.case.archived ? 'Unarchive' : 'Archive'}
          </button>
        </div>
        <div>
          <strong>Delete this case</strong>
          <p className="muted" style={{ margin: '2px 0 8px' }}>Permanently removes the case, its documents (including the stored files), facts, findings, letters and exports.</p>
          {!confirm ? (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirm(true)}>
              Delete case…
            </button>
          ) : (
            <div className="row">
              <button className="btn btn-sm btn-danger" onClick={del} disabled={busy}>
                Yes, delete everything for this case
              </button>
              <button className="btn btn-sm" onClick={() => setConfirm(false)}>
                Keep it
              </button>
            </div>
          )}
        </div>
        {err ? <p role="alert" className="error-text">{err}</p> : null}
      </div>
    </Dialog>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading case">
      <Skeleton h={28} w="50%" />
      <div style={{ height: 8 }} />
      <Skeleton h={14} w="30%" />
      <div style={{ height: 16 }} />
      <div className="summary-strip">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="cell">
            <Skeleton h={12} w="60%" />
            <div style={{ height: 8 }} />
            <Skeleton h={24} w="80%" />
          </div>
        ))}
      </div>
      <div className="three-col" style={{ marginTop: 24 }}>
        <div className="card"><Skeleton h={90} /></div>
        <div className="card"><Skeleton h={260} /></div>
        <div className="card"><Skeleton h={180} /></div>
      </div>
    </div>
  );
}
