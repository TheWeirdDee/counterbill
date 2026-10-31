/**
 * Case Agent: reacts to material events from the other agents, coalesces bursts (documented debounce), and revises
 * the case assessment. Earlier interpretations are superseded, never silently overwritten, and the reason for
 * each change is recorded with the assessment.
 */
import { createAgent } from '@mozaik-ai/core';
import {
  addQuestion,
  applyFinding,
  buildEvidenceIndex,
  currentInterpretation,
  insertAssessment,
  latestAssessment,
  listCalculations,
  listFacts,
  listFindings,
  listTimeline,
  setFindingStatus,
  type FindingRow,
  type QuestionRow,
} from '@/db/repo';
import { allowedFigures, contentHash, forbiddenLanguage, unsupportedFigures, type FactLite } from '@/domain/case-rules';
import { refKind } from '@/domain/citations';
import { ASSESSMENT_CLASS_LABEL, CaseOutput } from '@/domain/schemas';
import { emit } from '../events';
import { loopHandlers, reactTo } from '../handlers';
import { caseMessage, INSTRUCTIONS } from '../prompts';
import { state } from '../runtime';
import { runAgentTask, scheduleIdleCheck } from '../tasks';
import { finish, requireKnownRefs } from './common';

/** Intentional stabilisation window: several events arriving close together produce ONE assessment. */
export const CASE_DEBOUNCE_MS = 1800;
const RESERVED = /^(volume:|package_|missing:)/;

const TRIGGERS = ['calculation.completed', 'finding.proposed', 'finding.revised', 'contract.interpretation', 'timeline.updated', 'finding.challenged', 'fact.corrected', 'question.answered'] as const;

const pending = new Set<string>();
const pendingEventIds: string[] = [];

export function createCaseAgent() {
  return createAgent({
    name: 'Case Agent',
    capabilities: ['inference'],
    instruction: INSTRUCTIONS.case,
    tools: [],
    handlers: [
      ...loopHandlers(),
      // Not routed through `reactTo`'s queue: this only schedules the debounced assessment.
      ...TRIGGERS.map((type) =>
        reactTo('case', [type], (e, p) => {
          const s = state();
          pending.add(`${e.type}${p.topic ? `:${String(p.topic)}` : ''}`);
          pendingEventIds.push(p.eventId);
          const existing = s.timers.get('case');
          if (existing) clearTimeout(existing);
          s.timers.set(
            'case',
            setTimeout(() => {
              const triggers = [...pending];
              const causation = pendingEventIds.splice(0).join(',').slice(0, 200);
              pending.clear();
              // Keep the run "busy" across the hand-over from debounce timer to task.
              s.inFlight.add('case:handover');
              s.timers.delete('case');
              void runCase(triggers, causation).finally(() => {
                s.inFlight.delete('case:handover');
                scheduleIdleCheck();
              });
            }, CASE_DEBOUNCE_MS),
          );
        }),
      ),
    ],
  });
}

const lite = (f: { ref: string; key: string; subject: string | null; value: string; unit: string | null; currency: string | null; status: string }): FactLite => ({
  ref: f.ref,
  key: f.key,
  subject: f.subject,
  value: f.value,
  unit: f.unit,
  currency: f.currency,
  status: f.status,
});

async function signature(caseId: string, triggers: string[]): Promise<string> {
  const [facts, calcs, finds, interp, timeline] = await Promise.all([listFacts(caseId), listCalculations(caseId), listFindings(caseId), currentInterpretation(caseId), listTimeline(caseId)]);
  const challenges = triggers.filter((t) => t.startsWith('finding.challenged') || t.startsWith('question.answered') || t.startsWith('fact.corrected'));
  return contentHash({
    f: facts.map((f) => [f.ref, f.value]),
    c: calcs.map((c) => [c.ref, c.output]),
    n: finds.filter((f) => !f.topic.startsWith('interpretation:')).map((f) => [f.ref, f.status]),
    i: interp?.ref ?? null,
    t: timeline.length,
    x: challenges,
  });
}

async function runCase(triggers: string[], causation: string) {
  const s = state();
  if (s.cancelled) return;
  const sig = await signature(s.caseId, triggers);
  if (s.inputSignature.get('case') === sig) return;
  const first = (await latestAssessment(s.caseId)) === null;
  await runAgentTask({
    role: 'case',
    label: first ? 'Initial assessment' : 'Reassess after new evidence',
    triggerEventId: causation || null,
    schema: CaseOutput,
    schemaName: 'case_output',
    buildMessage: (fb) => caseMessage(s.caseId, triggers, fb),
    async commit(out, { db, revision, runId, caseId }) {
      const index = await buildEvidenceIndex(caseId, db);
      const facts = await listFacts(caseId, {}, db);
      const calcs = await listCalculations(caseId, {}, db);
      const active = await listFindings(caseId, {}, db);
      const activeRefs = new Set(active.map((f) => f.ref));
      const problems: string[] = [];

      out.findings.forEach((f, i) => {
        const where = `findings[${i}] (${f.topic})`;
        if (RESERVED.test(f.topic)) problems.push(`${where}: topics starting with volume:, package_ or missing: belong to the Billing Agent; use interpretation:* topics`);
        requireKnownRefs([...f.factRefs, ...f.calcRefs, ...f.spanRefs], index, where, problems);
        if (f.factRefs.some((r) => refKind(r) !== 'fact')) problems.push(`${where}: factRefs must be F-identifiers`);
        if (f.calcRefs.some((r) => refKind(r) !== 'calculation')) problems.push(`${where}: calcRefs must be C-identifiers`);
        if (f.basis === 'sourced' && !f.factRefs.length && !f.calcRefs.length && !f.spanRefs.length) problems.push(`${where}: a "sourced" finding must cite at least one fact, calculation or span (or be labelled basis "inference")`);
        if (f.status === 'supported' && f.category === 'supported_discrepancy' && !f.calcRefs.length) problems.push(`${where}: a supported discrepancy needs a calculation reference`);
      });
      out.findingOps.forEach((op, i) => {
        if (!activeRefs.has(op.ref)) problems.push(`findingOps[${i}]: ${op.ref} is not an active finding`);
      });
      const allowed = allowedFigures(facts.map(lite), calcs);
      const prose = [out.headline, out.summary, out.strongestCounterExplanation, out.changeReason ?? '', out.nextAction, ...out.findings.flatMap((f) => [f.title, f.explanation]), ...out.questions.map((q) => q.prompt)].join('\n');
      const bad = unsupportedFigures(prose, allowed);
      if (bad.length) problems.push(`Your text states figures that are not in the facts or calculations: ${bad.join(', ')}.`);
      if (forbiddenLanguage(prose).length) problems.push('Your text uses accusatory, entitlement or threatening language; keep it neutral and factual.');
      if (first === false && !out.changeReason) problems.push('This is a reassessment: changeReason must say what changed and why, citing identifiers.');
      finish(problems);

      const prev = await latestAssessment(caseId, db);
      const prevSnapshot = ((prev?.changeDiff as { snapshot?: Record<string, string> } | undefined)?.snapshot ?? {}) as Record<string, string>;
      const meta = { producedBy: 'case', runId, evidenceRevision: revision };

      const created: FindingRow[] = [];
      const revised: { from: FindingRow | null; to: FindingRow }[] = [];
      for (const f of out.findings) {
        const res = await applyFinding(db, caseId, f, { ...meta, reason: out.changeReason });
        if (res.outcome === 'created') created.push(res.finding);
        if (res.outcome === 'revised') revised.push({ from: res.previous, to: res.finding });
      }
      const withdrawn: FindingRow[] = [];
      const statusChanged: FindingRow[] = [];
      for (const op of out.findingOps) {
        const status = op.action === 'withdraw' ? 'superseded' : op.action === 'confirm' ? 'supported' : 'disputed';
        const row = await setFindingStatus(db, caseId, op.ref, status, op.reason);
        if (row) (op.action === 'withdraw' ? withdrawn : statusChanged).push(row);
      }
      const questions: QuestionRow[] = [];
      for (const q of out.questions) {
        const r = await addQuestion(db, caseId, q, { raisedBy: 'case', runId, evidenceRevision: revision });
        if (r.inserted) questions.push(r.question);
      }

      const snapshot: Record<string, string> = {};
      for (const c of calcs.filter((c) => c.kind === 'charge_difference')) snapshot[c.topic] = c.display;
      const numbers = Object.entries(snapshot)
        .filter(([k, v]) => prevSnapshot[k] !== undefined && prevSnapshot[k] !== v)
        .map(([k, v]) => ({ topic: k, from: prevSnapshot[k], to: v }));
      const classChanged = !!prev && prev.classification !== out.classification;
      const changed = !prev || classChanged || created.length > 0 || revised.length > 0 || withdrawn.length > 0 || numbers.length > 0;
      const diff = {
        classification: prev ? { from: prev.classification, to: out.classification } : null,
        created: created.map((f) => ({ ref: f.ref, topic: f.topic, title: f.title })),
        revised: revised.map((r) => ({ from: r.from && { ref: r.from.ref, title: r.from.title, status: r.from.status }, to: { ref: r.to.ref, title: r.to.title, status: r.to.status } })),
        withdrawn: withdrawn.map((f) => ({ ref: f.ref, title: f.title, reason: f.changeReason })),
        statusChanged: statusChanged.map((f) => ({ ref: f.ref, title: f.title, status: f.status, reason: f.changeReason })),
        numbers,
        snapshot,
        changed,
      };
      const assessment = await insertAssessment(db, caseId, {
        classification: out.classification,
        headline: out.headline,
        summary: out.summary,
        strongestCounter: out.strongestCounterExplanation,
        changeReason: out.changeReason,
        changeDiff: diff,
        nextAction: out.nextAction,
        readiness: out.readiness,
        runId,
        evidenceRevision: revision,
      });
      return {
        result: { assessment, created, revised, withdrawn, statusChanged, questions, changed },
        summary: `${ASSESSMENT_CLASS_LABEL[out.classification]}.${classChanged ? ' The previous reading was revised.' : ''}`,
      };
    },
    async after({ assessment, created, revised, questions, changed }) {
      s.inputSignature.set('case', sig); // what this pass read, not what exists now
      s.assessmentVersion = assessment.version;
      for (const f of created) await emit('finding.proposed', { findingRef: f.ref, topic: f.topic, by: 'case' }, { producer: 'case', causationId: causation });
      for (const r of revised) await emit('finding.revised', { findingRef: r.to.ref, topic: r.to.topic, supersedes: r.to.supersedesRef, by: 'case' }, { producer: 'case', causationId: causation });
      if (questions.length) await emit('question.raised', { questionRefs: questions.map((q) => q.ref), by: 'case' }, { producer: 'case', causationId: causation });
      await emit('assessment.updated', { version: assessment.version, classification: assessment.classification, changed }, { producer: 'case', causationId: causation });
    },
  });
}
