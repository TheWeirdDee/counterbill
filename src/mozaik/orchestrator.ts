/**
 * One investigation run, hosted in one worker process.
 *
 * Responsibilities: initialise the Mozaik runtime exactly once, materialise the case state from PostgreSQL,
 * join the six agents plus a coordinator and a trace observer, publish the starting event (`case.started`, or
 * `evidence.added` for a reassessment), then let the agents react to each other until nothing is in flight.
 */
import { Agent, supportedModels, DefaultInferenceRunner, type InferenceInput, type InferenceRunner, createHuman } from '@mozaik-ai/core';
import { one, query } from '@/db/pool';
import {
  appendEvent,
  getCase,
  getRun,
  latestAssessment,
  listDocuments,
  listFacts,
  listFindings,
  listQuestions,
  pendingProposal,
  currentDraft,
  type RunRow,
} from '@/db/repo';
import { AGENT_ROLES, type AgentRole } from '@/domain/schemas';
import { config, inferenceReadiness } from '@/server/config';
import { createBillingAgent } from './agents/billing';
import { createCaseAgent } from './agents/case';
import { createContractAgent } from './agents/contract';
import { createDraftingAgent } from './agents/drafting';
import { createEvidenceAgent } from './agents/evidence';
import { createTimelineAgent } from './agents/timeline';
import { emit } from './events';
import { InstrumentedRunner } from './instrumented-runner';
import { initializeRuntime, join, resolveRuntime, state } from './runtime';
import { CounterbillState } from './state';
import { ScriptedInferenceRunner } from './test-runner';
import { runnerHooks, setIdleCallback } from './tasks';
import { createTraceObserver } from './trace';

/** Mirrors Mozaik's request validation for the capabilities we rely on (tools, structured output). */
const requestValidator = {
  validate(input: InferenceInput, spec: { name: string; supportsFunctionCalling: boolean; supportsStructuredOutput: boolean }) {
    if (input.tools?.length && !spec.supportsFunctionCalling) throw new Error(`Model "${spec.name}" does not support tool calling`);
    if (input.structuredOutput && !spec.supportsStructuredOutput) throw new Error(`Model "${spec.name}" does not support structured output`);
  },
};

export interface RunOutcome {
  status: 'completed' | 'partial' | 'failed' | 'cancelled';
  errorCode?: string;
  errorMessage?: string;
}

export async function runInvestigation(runId: string): Promise<RunOutcome> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run ${runId} not found`);
  const c = await getCase(run.caseId);
  if (!c) throw new Error(`Case ${run.caseId} not found`);

  const readiness = inferenceReadiness();
  if (!readiness.ready) {
    await appendEvent({
      caseId: c.id,
      runId,
      type: 'run.failed',
      producer: 'system',
      payload: { code: readiness.code, message: readiness.message },
      evidenceRevision: run.evidenceRevision,
      idempotencyKey: `${runId}:run.failed:setup`,
    });
    return { status: 'failed', errorCode: readiness.code, errorMessage: readiness.message };
  }

  // ---- runtime (initialised once in this process)
  const inner: InferenceRunner =
    readiness.mode === 'test' ? new ScriptedInferenceRunner() : new DefaultInferenceRunner(supportedModels, requestValidator as never);
  const runner = new InstrumentedRunner(inner, config.maxModelCallsPerRun, runnerHooks, (n) => void query('update investigation_runs set model_calls = $2 where id = $1', [runId, n]).catch(() => {}));
  const st = new CounterbillState();
  st.caseId = c.id;
  st.runId = runId;
  st.evidenceRevision = run.evidenceRevision;
  st.inferenceMode = readiness.mode;
  st.model = readiness.model;
  st.targeted = run.targetedAgents as AgentRole[];
  initializeRuntime({ state: st, inferenceRunnerConfig: { runner } });

  const coordinator = createHuman({ name: 'Coordinator', capabilities: [], handlers: [] });
  const trace = createTraceObserver();
  const agents: Record<AgentRole, Agent> = {
    evidence: createEvidenceAgent(),
    billing: createBillingAgent(),
    contract: createContractAgent(),
    timeline: createTimelineAgent(),
    case: createCaseAgent(),
    drafting: createDraftingAgent(),
  };
  st.participantIds.set('system', coordinator.getId());
  st.participantIds.set('trace', trace.getId());
  for (const role of AGENT_ROLES) st.participantIds.set(role, agents[role].getId());

  await materialise(st);

  join(coordinator);
  join(trace);
  for (const role of AGENT_ROLES) join(agents[role]);

  await query(
    'update investigation_runs set model = $2 where id = $1',
    [runId, readiness.mode === 'test' ? 'counterbill-test-runner (TEST MODE)' : readiness.model],
  );
  await emit('run.started', { kind: run.kind, inferenceMode: readiness.mode, model: st.model, targeted: st.targeted, agents: AGENT_ROLES.map((r) => ({ role: r, mozaikAgentId: agents[r].getId() })) }, { producer: 'system', key: `${runId}:run.started` });

  // ---- completion + cancellation
  const finished = new Promise<RunOutcome>((resolve) => {
    let done = false;
    const finish = (o: RunOutcome) => {
      if (done) return;
      done = true;
      resolve(o);
    };
    setIdleCallback(() => {
      void (async () => {
        const o = await finalise(run, st);
        finish(o);
      })();
    });
    const poll = setInterval(async () => {
      try {
        const r = await getRun(runId);
        await query("update investigation_runs set lease_expires_at = now() + interval '60 seconds' where id = $1 and status = 'running'", [runId]);
        if (r?.cancelRequested && !st.cancelled) {
          st.cancelled = true;
          for (const t of st.timers.values()) clearTimeout(t);
          st.timers.clear();
          await emit('run.cancelled', { reason: r.cancelReason ?? 'cancelled' }, { producer: 'system', key: `${runId}:run.cancelled` });
          clearInterval(poll);
          finish({ status: 'cancelled', errorCode: 'cancelled', errorMessage: r.cancelReason ?? 'Run cancelled.' });
        }
        if (done) clearInterval(poll);
      } catch {
        /* transient db error: next tick */
      }
    }, 1000);
    poll.unref?.();
  });

  // ---- kick off: the first wave reacts independently to the same event
  const docs = await listDocuments(c.id);
  const readyRefs = docs.filter((d) => d.parseStatus === 'ready').map((d) => d.ref);
  const trigger = run.trigger as { documentRefs?: string[]; reason?: string; events?: { type: string; payload: Record<string, unknown> }[] };
  if (run.kind === 'reassess') {
    // A reassessment starts from what changed, never from case.started: only affected agents wake up.
    if (trigger.documentRefs?.length) {
      const added = docs.filter((d) => trigger.documentRefs!.includes(d.ref));
      await emit('evidence.added', { documentRefs: trigger.documentRefs, kinds: added.map((d) => d.kind), reason: trigger.reason ?? 'New evidence added' }, { producer: 'system', key: `${runId}:evidence.added` });
    }
    for (const [i, ev] of (trigger.events ?? []).entries()) {
      await emit(ev.type as never, ev.payload, { producer: 'system', key: `${runId}:${ev.type}:${i}` });
    }
  } else {
    await emit('case.started', { documentRefs: readyRefs, targeted: st.targeted }, { producer: 'system', key: `${runId}:case.started` });
  }
  // A run with no readable evidence at all has nothing to react to; let the idle check conclude it.
  const { scheduleIdleCheck } = await import('./tasks');
  scheduleIdleCheck();
  return finished;
}

async function materialise(st: CounterbillState) {
  const [facts, findings, questions, assessment, draft] = await Promise.all([listFacts(st.caseId), listFindings(st.caseId), listQuestions(st.caseId), latestAssessment(st.caseId), currentDraft(st.caseId)]);
  st.facts = new Map(facts.map((f) => [f.ref, f]));
  st.findings = new Map(findings.map((f) => [f.ref, f]));
  st.questions = new Map(questions.map((q) => [q.ref, q]));
  st.assessmentVersion = assessment?.version ?? 0;
  st.draftVersion = draft?.version ?? 0;
}

async function finalise(run: RunRow, st: CounterbillState): Promise<RunOutcome> {
  await materialise(st);
  const [assessment, draft, proposal, questions] = await Promise.all([latestAssessment(st.caseId), currentDraft(st.caseId), pendingProposal(st.caseId), listQuestions(st.caseId)]);
  const failed = [...st.failedRoles];
  const openUserQuestions = questions.filter((q) => q.status === 'open' && q.audience === 'user').length;
  const status: RunOutcome['status'] = failed.length ? (st.facts.size || assessment ? 'partial' : 'failed') : 'completed';
  const caseStatus =
    status === 'failed'
      ? 'failed'
      : failed.length || st.phase === 'needs_input' || assessment?.readiness === 'needs_input' || (openUserQuestions > 0 && !draft)
        ? 'needs_input'
        : draft || proposal
          ? 'review_ready'
          : 'needs_input';
  await query('update cases set status = $2, updated_at = now() where id = $1', [st.caseId, caseStatus]);
  await emit(
    status === 'failed' ? 'run.failed' : 'run.completed',
    {
      status,
      failedRoles: failed,
      caseStatus,
      assessmentVersion: assessment?.version ?? null,
      draftVersion: draft?.version ?? null,
      duplicateEventsDropped: st.duplicateEventsDropped,
      staleResultsDiscarded: st.staleResultsDiscarded,
      modelCalls: (resolveRuntime().getInferenceRunner() as InstrumentedRunner).calls,
    },
    { producer: 'system', key: `${run.id}:run.final` },
  );
  return status === 'failed'
    ? { status, errorCode: 'agents_failed', errorMessage: `No usable result: ${failed.join(', ')} failed.` }
    : { status, errorCode: failed.length ? 'agent_failures' : undefined, errorMessage: failed.length ? `Finished with limitations: ${failed.join(', ')} did not complete.` : undefined };
}

export { one, state };
