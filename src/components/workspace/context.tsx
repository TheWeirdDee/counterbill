'use client';

import { createContext, useContext } from 'react';
import type { CaseState } from '@/server/case-state';
import type { Connection, StreamEvent } from './useCaseState';

export interface WsActions {
  openSource: (ref: string) => void;
  openAddEvidence: () => void;
  openChallenge: (findingRef: string) => void;
  openCorrect: (factRef: string) => void;
  openManualEntry: (docRef?: string) => void;
  openQuestions: () => void;
  refetch: () => Promise<boolean>;
}

export interface WsValue {
  state: CaseState;
  events: StreamEvent[];
  connection: Connection;
  base: string; // route prefix for tab links, e.g. /app/cases/<id>
  isDemo: boolean;
  actions: WsActions;
}

const Ctx = createContext<WsValue | null>(null);
export const WsProvider = Ctx.Provider;
export function useWs(): WsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWs outside provider');
  return v;
}

export const ROLE_LABEL: Record<string, string> = {
  evidence: 'Evidence Agent',
  billing: 'Billing Agent',
  contract: 'Contract Agent',
  timeline: 'Timeline Agent',
  case: 'Case Agent',
  drafting: 'Drafting Agent',
  system: 'System',
  human: 'You',
  trace: 'Trace',
};

export const ROLE_BLURB: Record<string, string> = {
  evidence: 'Reads documents and records cited facts',
  billing: 'Chooses comparisons; code does the maths',
  contract: 'Looks for chargeable-volume terms',
  timeline: 'Reconstructs the sequence of events',
  case: 'Weighs the evidence and revises findings',
  drafting: 'Writes the letter and proposes revisions',
};

/** Plain-language line for a persisted event. */
export function describeEvent(e: StreamEvent): string {
  const p = e.payload as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? (v as string[]).join(', ') : '');
  switch (e.type) {
    case 'run.queued':
      return `Investigation queued (${String(p.kind ?? '')}).`;
    case 'run.started':
      return `Run started${p.inferenceMode === 'test' ? ' in TEST MODE (scripted stand-in, not live AI)' : ` with ${String(p.model ?? 'the configured model')}`}.`;
    case 'case.started':
      return 'Investigation started: all first-wave agents were notified at once.';
    case 'evidence.added':
      return `New evidence ${list(p.documentRefs)} triggered a targeted reassessment.`;
    case 'evidence.parsed':
      return `Document ${String(p.documentRef)} ${p.status === 'ready' ? 'was read' : `needs attention (${String(p.status)})`}.`;
    case 'fact.recorded':
      return `${ROLE_LABEL[String(p.by)] ?? String(p.by)} recorded ${list(p.factRefs)} (${list(p.keys)}).`;
    case 'fact.corrected':
      return `Fact ${String(p.replacesRef)} was corrected by you (new fact ${String(p.factRef)}).`;
    case 'calculation.completed':
      return `Calculations ${list(p.calcRefs)} completed.`;
    case 'contract.interpretation':
      return `Contract reading: ${String(p.termsStatus).replace('_', ' ')}${p.affectsCalculation ? ' (changes the chargeable volume)' : ''}.`;
    case 'timeline.updated':
      return `Timeline updated (${list(p.eventRefs)}).`;
    case 'question.raised':
      return `Questions raised: ${list(p.questionRefs)}.`;
    case 'question.answered':
      return `You answered ${String(p.questionRef)}.`;
    case 'finding.proposed':
      return `Finding ${String(p.findingRef)} proposed (${String(p.topic)}).`;
    case 'finding.revised':
      return `Finding ${String(p.findingRef)} replaced ${String(p.supersedes ?? 'an earlier reading')}; the earlier reading is kept as superseded.`;
    case 'finding.challenged':
      return `You challenged ${String(p.findingRef)}.`;
    case 'assessment.updated':
      return `Assessment v${String(p.version)}: ${String(p.classification).replace(/_/g, ' ')}${p.changed ? '' : ' (no material change)'}.`;
    case 'draft.updated':
      return `Letter draft v${String(p.version)} ${p.proposed ? 'saved, with proposed changes to sections you edited' : 'saved'}.`;
    case 'agent.started':
      return `Started: ${String(p.label ?? '')}${Number(p.attempt) > 1 ? ` (attempt ${String(p.attempt)})` : ''}`;
    case 'agent.completed':
      return String(p.summary ?? 'Finished.');
    case 'agent.failed':
      return `Failed (${String(p.code)}): ${String(p.message)}`;
    case 'agent.result_discarded':
      return `A result for evidence revision ${String(p.taskRevision)} was discarded because the case is now at ${String(p.currentRevision)}.`;
    case 'run.completed':
      return `Run finished${(p.failedRoles as string[] | undefined)?.length ? ` with limitations: ${list(p.failedRoles)} did not complete` : ''}.`;
    case 'run.failed':
      return `Run could not finish: ${String(p.message ?? p.code ?? '')}`;
    case 'run.cancelled':
      return `Run cancelled: ${String(p.reason ?? '')}`;
    case 'mozaik.loop.started':
      return `Mozaik loop ${String(p.loopId).slice(0, 8)} started.`;
    case 'mozaik.inference.started':
      return `Model call started (${String(p.model ?? '')}).`;
    case 'mozaik.inference.completed': {
      const t = p.tokens as { input: number; output: number } | null;
      return `Model call completed${t ? ` (${t.input} in / ${t.output} out tokens)` : ''}.`;
    }
    case 'mozaik.function_call.started':
      return `Tool call: ${String(p.tool)}.`;
    case 'mozaik.function_call.completed':
      return 'Tool returned.';
    case 'mozaik.model.answer':
      return 'Model answer received.';
    default:
      return e.type;
  }
}
