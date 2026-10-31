/**
 * The workspace read-model: one consistent snapshot of a case assembled from PostgreSQL. The browser re-fetches it
 * whenever the event stream says something changed, so reconnects and refreshes always converge on the same state.
 */
import { one, query } from '@/db/pool';
import {
  camel,
  currentDraft,
  currentInterpretation,
  listAgentRuns,
  listAssessments,
  listCalculations,
  listDocuments,
  listDrafts,
  listFacts,
  listFindings,
  listQuestions,
  listRuns,
  listTimeline,
  pendingProposal,
  type AgentRunRow,
  type CalcRow,
  type CaseRow,
  type DocumentRow,
  type DraftRow,
  type FactRow,
} from '@/db/repo';
import { formatCbm } from '@/domain/calculations';
import { AGENT_ROLES, SOURCE_CLASS_LABEL, type AgentRole } from '@/domain/schemas';
import { getDemoCase } from './demo';
import { inferenceReadiness } from './config';

export interface SummaryItem {
  label: string;
  value: string | null;
  note: string;
  refs: string[];
  calcRef?: string;
}

export type AgentView = {
  role: AgentRole;
  status: 'idle' | 'queued' | 'investigating' | 'revising' | 'finished' | 'failed';
  summary: string | null;
  error: string | null;
  tasks: AgentRunRow[];
};

function pick(calcs: CalcRow[], topics: string[], kind: string): CalcRow | undefined {
  for (const t of topics) {
    const c = calcs.find((k) => k.topic === `${t}:${kind}` && k.status === 'current');
    if (c) return c;
  }
  return undefined;
}

export function buildSummary(facts: FactRow[], calcs: CalcRow[]): SummaryItem[] {
  const f = (key: string) => facts.find((x) => x.key === key && x.provenance !== 'user_statement') ?? facts.find((x) => x.key === key);
  const billed = f('billed_volume_cbm') ?? f('chargeable_volume_cbm');
  const measured = f('measured_volume_cbm');
  const declared = f('declared_volume_cbm');
  const alt = measured ?? declared;
  const rate = f('rate_per_cbm');
  const diff = pick(calcs, ['billed_vs_measured', 'billed_vs_contract_term', 'billed_vs_declared'], 'charge_difference');
  const diffMeasured = pick(calcs, ['billed_vs_measured'], 'charge_difference');
  const useDiff = diffMeasured ?? diff;
  const label = useDiff?.topic.startsWith('billed_vs_measured') ? 'under the surveyed volume' : useDiff?.topic.startsWith('billed_vs_contract_term') ? 'under the stated contract term' : useDiff ? 'against the packing-list estimate' : '';
  return [
    { label: 'Billed volume', value: billed ? `${formatCbm(billed.value)} CBM` : null, note: billed ? (billed.provenance === 'user_statement' ? 'User-provided' : 'From a document') : 'Not yet established', refs: billed ? [billed.ref] : [] },
    {
      label: measured ? 'Measured volume' : 'Packing-list estimate',
      value: alt ? `${formatCbm(alt.value)} CBM` : null,
      note: alt ? (measured ? 'Independent measurement' : 'Shipper’s estimate, not a measurement') : 'Not yet established',
      refs: alt ? [alt.ref] : [],
    },
    { label: 'Rate', value: rate ? `${rate.currency === 'NGN' ? '₦' : (rate.currency ?? '') + ' '}${Number(rate.value).toLocaleString('en-NG')} / CBM` : null, note: rate ? 'From a document' : 'Not yet established', refs: rate ? [rate.ref] : [] },
    {
      label: 'Difference under review',
      value: useDiff ? useDiff.display : null,
      note: useDiff ? `A comparison ${label}, not a refund` : 'Not yet established',
      refs: useDiff ? useDiff.inputFactRefs : [],
      calcRef: useDiff?.ref,
    },
  ];
}

function deriveAgents(agentRuns: AgentRunRow[], latestRun: { status: string; id: string } | null): AgentView[] {
  const runTasks = latestRun ? agentRuns.filter((a) => a.runId === latestRun.id) : [];
  return AGENT_ROLES.map((role) => {
    const tasks = runTasks.filter((t) => t.agentRole === role);
    const running = tasks.find((t) => t.status === 'running');
    const completed = tasks.filter((t) => t.status === 'completed');
    const failed = tasks.filter((t) => t.status === 'failed');
    const lastDone = completed[completed.length - 1];
    let status: AgentView['status'] = 'idle';
    if (running) status = completed.length > 0 || running.attempt > 1 ? 'revising' : 'investigating';
    else if (failed.length && !completed.length) status = 'failed';
    else if (failed.length && failed[failed.length - 1].startedAt > (lastDone?.startedAt ?? '')) status = 'failed';
    else if (completed.length) status = 'finished';
    else if (latestRun?.status === 'queued') status = 'queued';
    return { role, status, summary: lastDone?.resultSummary ?? null, error: failed.length ? (failed[failed.length - 1].error ?? null) : null, tasks };
  });
}

export async function buildCaseState(c: CaseRow, opts: { role: 'owner' | 'demo' }) {
  const caseId = c.id;
  const [docs, facts, calcs, findings, questions, timeline, interp, assessments, runs, agentRunsAll, draft, proposal, drafts] = await Promise.all([
    listDocuments(caseId),
    listFacts(caseId, { includeInactive: true }),
    listCalculations(caseId, { all: true }),
    listFindings(caseId, { includeSuperseded: true }),
    listQuestions(caseId),
    listTimeline(caseId),
    currentInterpretation(caseId),
    listAssessments(caseId),
    listRuns(caseId),
    listAgentRuns(caseId),
    currentDraft(caseId),
    pendingProposal(caseId),
    listDrafts(caseId),
  ]);
  const spanCounts = await query<{ document_ref: string; n: string }>('select document_ref, count(*) as n from spans where case_id = $1 group by document_ref', [caseId]);
  const exportsRows = await query('select id, kind, filename, draft_version, evidence_revision, size_bytes, reviewed, created_at from exports where case_id = $1 order by created_at desc limit 30', [caseId]);
  const lastSeq = await one<{ seq: string | null }>('select max(seq)::text as seq from case_events where case_id = $1', [caseId]);
  const activeFacts = facts.filter((f) => f.status === 'active');
  const activeCalcs = calcs.filter((k) => k.status === 'current');
  const latestRun = runs[0] ?? null;
  const activeRun = runs.find((r) => r.status === 'queued' || r.status === 'running') ?? null;
  const demo = c.demoSlug ? getDemoCase(c.demoSlug) : undefined;
  const readiness = inferenceReadiness();

  return {
    case: c,
    role: opts.role,
    readiness: readiness.ready ? { ready: true as const, mode: readiness.mode, model: readiness.model } : { ready: false as const, code: readiness.code, message: readiness.message },
    demo: demo
      ? {
          slug: demo.slug,
          source: demo.source,
          publicFacts: demo.publicFacts,
          steps: demo.steps.map((s) => ({ id: s.id, title: s.title, description: s.description, added: docs.some((d) => d.originalFilename === s.doc.displayName) })),
        }
      : null,
    documents: docs.map((d: DocumentRow) => ({
      ...d,
      spanCount: Number(spanCounts.find((s) => s.document_ref === d.ref)?.n ?? 0),
      sourceClassLabel: d.sourceLabel ?? SOURCE_CLASS_LABEL[d.sourceClass as keyof typeof SOURCE_CLASS_LABEL] ?? d.sourceClass,
    })),
    facts,
    calculations: calcs,
    findings,
    questions,
    timeline,
    interpretation: interp,
    assessments,
    latestAssessment: assessments[0] ?? null,
    summary: buildSummary(activeFacts, activeCalcs),
    runs: runs.slice(0, 12),
    activeRun,
    latestRun,
    agents: deriveAgents(agentRunsAll, latestRun),
    agentRuns: agentRunsAll,
    draft,
    proposal,
    drafts: drafts.map((d: DraftRow) => ({ version: d.version, status: d.status, createdBy: d.createdBy, changeSummary: d.changeSummary, evidenceRevision: d.evidenceRevision, createdAt: d.createdAt })),
    exports: exportsRows.map((e) => camel(e)),
    stale: {
      draft: !!draft && draft.evidenceRevision < c.revision,
      exports: exportsRows.length > 0 && Number((exportsRows[0] as { evidence_revision: number }).evidence_revision) < c.revision,
    },
    lastSeq: lastSeq?.seq ?? '0',
  };
}

export type CaseState = Awaited<ReturnType<typeof buildCaseState>>;
