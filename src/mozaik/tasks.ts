/**
 * The task engine that sits between Mozaik event handlers and the database.
 *
 * A handler (reacting to a SemanticEvent) calls `runAgentTask`. The task starts a Mozaik loop with `runLoop`
 * (fire-and-forget, own loopId, fresh bounded ModelContext), waits for that loop's `model.answer`, then:
 *   parse JSON → validate with Zod → validate citations against the evidence store → commit in ONE transaction
 *   that first checks the case's evidence revision (stale results are discarded) → emit follow-on events.
 * A validation failure is retried once with the problems fed back; anything else leaves honest partial results.
 */
import { Agent, DeveloperMessageItem, ModelContext, type InferenceOutput, type Tool } from '@mozaik-ai/core';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { one, query, tx } from '@/db/pool';
import { camel, type AgentRunRow } from '@/db/repo';
import { config, isGeminiModel } from '@/server/config';
import { AGENT_LABEL, type AgentRole } from '@/domain/schemas';
import { emit } from './events';
import { BudgetExceeded, ProviderError, type CallHooks } from './instrumented-runner';
import { providerJsonSchema } from './schema';
import { resolveParticipant, runLoop, state } from './runtime';

export class ValidationFailure extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join('; '));
    this.name = 'ValidationFailure';
  }
}
export class StaleResult extends Error {
  constructor(
    public readonly taskRevision: number,
    public readonly currentRevision: number,
  ) {
    super(`Result computed at evidence revision ${taskRevision}, but the case is now at ${currentRevision}.`);
    this.name = 'StaleResult';
  }
}

interface Handle {
  agentRunId: string;
  role: AgentRole;
  contextId: string;
  loopId?: string;
  settled: boolean;
  resolve(text: string): void;
  reject(err: Error): void;
}
const byContext = new Map<string, Handle>();
const byLoop = new Map<string, Handle>();

/** Called by an agent's own `message_received.started` handler: links Mozaik's loopId to our task. */
export function onLoopStarted(contextId: string, loopId: string): void {
  const h = byContext.get(contextId);
  if (!h) return;
  h.loopId = loopId;
  byLoop.set(loopId, h);
  void query('update agent_runs set mozaik_loop_id = $2 where id = $1', [h.agentRunId, loopId]).catch(() => {});
}

/** Called by an agent's own `model.answer` handler. */
export function onModelAnswer(loopId: string, text: string): void {
  const h = byLoop.get(loopId);
  if (h && !h.settled) {
    h.settled = true;
    h.resolve(text);
  }
}

export const runnerHooks: CallHooks = {
  onStart(contextId) {
    const h = byContext.get(contextId);
    if (h) void query('update agent_runs set inference_started_at = coalesce(inference_started_at, clock_timestamp()) where id = $1', [h.agentRunId]).catch(() => {});
  },
  onFinish(contextId, output: InferenceOutput) {
    const h = byContext.get(contextId);
    if (!h) return;
    const u = output.tokenUsage;
    void query(
      'update agent_runs set inference_finished_at = clock_timestamp(), input_tokens = coalesce(input_tokens,0) + $2, output_tokens = coalesce(output_tokens,0) + $3 where id = $1',
      [h.agentRunId, u?.inputTokens ?? null, u?.outputTokens ?? null],
    ).catch(() => {});
  },
  onRetry(contextId, info) {
    const h = byContext.get(contextId);
    if (!h) return;
    void emit('agent.rate_limited', { role: h.role, attempt: info.attempt, waitSeconds: Math.round(info.waitMs / 1000), code: info.code, reason: info.reason.slice(0, 200) }, { producer: h.role }).catch(() => {});
  },
  onError(contextId, error) {
    const h = byContext.get(contextId);
    if (h && !h.settled) {
      h.settled = true;
      h.reject(error);
    }
  },
};

export interface CommitContext {
  db: PoolClient;
  revision: number;
  runId: string;
  caseId: string;
  agentRunId: string;
}

export interface TaskSpec<T, R> {
  role: AgentRole;
  label: string;
  triggerEventId: string | null;
  schema: z.ZodType<T>;
  schemaName: string;
  tools?: Tool[];
  /** Build the user message from a snapshot of the case. `feedback` carries validation problems on a retry. */
  buildMessage(feedback: string | null): Promise<string>;
  /** Validate against the evidence store and write. Runs inside the stale-guard transaction. */
  commit(parsed: T, cx: CommitContext): Promise<{ result: R; summary: string }>;
  /** Emit follow-on events once the transaction has committed. */
  after?(result: R): Promise<void>;
}

function classifyError(err: unknown): { code: string; message: string; retryable: boolean } {
  const e = err as { status?: number; code?: string; message?: string; name?: string };
  const msg = (e?.message ?? String(err)).slice(0, 400);
  if (err instanceof BudgetExceeded) return { code: 'budget_exceeded', message: msg, retryable: false };
  if (e?.name === 'ValidationFailure') return { code: 'invalid_model_output', message: msg, retryable: true };
  // The inference wrapper has already made its bounded retries for rate limits and outages, so a provider error here is final.
  if (err instanceof ProviderError) return { code: err.code, message: err.message, retryable: false };
  if (e?.status === 401 || e?.status === 403) return { code: 'provider_auth', message: 'The model provider rejected the API key.', retryable: false };
  if (/timed out/i.test(msg)) return { code: 'agent_timeout', message: msg, retryable: true };
  return { code: 'agent_error', message: msg, retryable: true };
}

export interface TaskOutcome<R> {
  ok: boolean;
  discarded?: boolean;
  result?: R;
  error?: { code: string; message: string };
}

export async function runAgentTask<T, R>(spec: TaskSpec<T, R>): Promise<TaskOutcome<R>> {
  const s = state();
  const st = s.status(spec.role);
  if (s.cancelled) return { ok: false, error: { code: 'cancelled', message: 'Run was cancelled.' } };
  if (st.invocations >= config.maxAgentRevisions) {
    await emit('agent.failed', { role: spec.role, code: 'revision_cap', message: `${AGENT_LABEL[spec.role]} reached its limit of ${config.maxAgentRevisions} passes in this run; conflicting explanations are left for you to resolve.` }, { producer: spec.role });
    s.phase = 'needs_input';
    return { ok: false, error: { code: 'revision_cap', message: 'revision cap reached' } };
  }
  st.invocations++;
  st.activeTasks++;
  st.status = st.completedTasks > 0 ? 'revising' : 'investigating';
  const taskKey = `${spec.role}:${spec.label}:${st.invocations}`;
  s.inFlight.add(taskKey);

  let feedback: string | null = null;
  let last: { code: string; message: string } = { code: 'agent_error', message: 'unknown' };
  try {
    const maxAttempts = config.maxTaskAttempts;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const agentRunId = (
        await one<{ id: string }>(
          `insert into agent_runs(run_id, case_id, agent_role, task_label, mozaik_agent_id, status, attempt, trigger_event_id, evidence_revision, model_name)
           values ($1,$2,$3,$4,$5,'running',$6,$7,$8,$9) returning id`,
          [s.runId, s.caseId, spec.role, spec.label, s.participantIds.get(spec.role), attempt, spec.triggerEventId, s.evidenceRevision, s.model],
        )
      )!.id;
      await emit('agent.started', { role: spec.role, label: spec.label, attempt, agentRunId }, { producer: spec.role, causationId: spec.triggerEventId });

      try {
        const message = await spec.buildMessage(feedback);
        const raw = await callModel(spec, agentRunId, message);
        let parsed: T;
        try {
          parsed = spec.schema.parse(JSON.parse(raw));
        } catch (e) {
          const detail = e instanceof SyntaxError ? 'The output was not valid JSON.' : `The output did not match the required schema: ${(e as Error).message.slice(0, 300)}`;
          throw new ValidationFailure([detail]);
        }

        const committed = await tx(async (db) => {
          const row = await one<{ revision: number }>('select revision from cases where id = $1 for update', [s.caseId], db);
          if (!row || row.revision > s.evidenceRevision) throw new StaleResult(s.evidenceRevision, row?.revision ?? -1);
          return spec.commit(parsed, { db, revision: s.evidenceRevision, runId: s.runId, caseId: s.caseId, agentRunId });
        });

        await query("update agent_runs set status='completed', finished_at=clock_timestamp(), result_summary=$2 where id=$1", [agentRunId, committed.summary.slice(0, 500)]);
        st.completedTasks++;
        st.lastSummary = committed.summary;
        // A later successful pass reads the whole case again, so it supersedes an earlier failed one.
        s.failedRoles.delete(spec.role);
        st.lastError = null;
        await emit('agent.completed', { role: spec.role, label: spec.label, summary: committed.summary.slice(0, 500), agentRunId }, { producer: spec.role, causationId: spec.triggerEventId });
        if (spec.after) await spec.after(committed.result);
        return { ok: true, result: committed.result };
      } catch (err) {
        if (err instanceof StaleResult) {
          s.staleResultsDiscarded++;
          await query("update agent_runs set status='discarded', finished_at=clock_timestamp(), error=$2 where id=$1", [agentRunId, err.message]);
          await emit('agent.result_discarded', { role: spec.role, label: spec.label, taskRevision: err.taskRevision, currentRevision: err.currentRevision, reason: 'stale_evidence_revision' }, { producer: spec.role, causationId: spec.triggerEventId });
          return { ok: false, discarded: true, error: { code: 'stale_result', message: err.message } };
        }
        const c = classifyError(err);
        last = c;
        await query("update agent_runs set status='failed', finished_at=clock_timestamp(), error=$2 where id=$1", [agentRunId, `${c.code}: ${c.message}`]);
        if (!c.retryable || attempt === maxAttempts || s.cancelled) break;
        if (err instanceof ValidationFailure) feedback = err.problems.join('\n');
        else await new Promise((r) => setTimeout(r, 1500));
      }
    }
    st.status = 'failed';
    st.lastError = `${last.code}: ${last.message}`;
    s.failedRoles.add(spec.role);
    await emit('agent.failed', { role: spec.role, code: last.code, message: last.message, label: spec.label }, { producer: spec.role, causationId: spec.triggerEventId });
    return { ok: false, error: last };
  } finally {
    st.activeTasks--;
    if (st.activeTasks === 0 && st.status !== 'failed') st.status = 'finished';
    s.inFlight.delete(taskKey);
    scheduleIdleCheck();
  }
}

async function callModel<T, R>(spec: TaskSpec<T, R>, agentRunId: string, message: string): Promise<string> {
  const s = state();
  const agent = resolveParticipant(s.participantIds.get(spec.role)!) as Agent;
  const context = ModelContext.create().addContextItem(DeveloperMessageItem.create(agent.getDeveloperMessage()));
  let timer: NodeJS.Timeout | undefined;
  const answer = new Promise<string>((resolve, reject) => {
    const handle: Handle = { agentRunId, role: spec.role, contextId: context.id, settled: false, resolve, reject };
    byContext.set(context.id, handle);
    timer = setTimeout(() => {
      if (!handle.settled) {
        handle.settled = true;
        reject(new Error(`${AGENT_LABEL[spec.role]} timed out after ${Math.round(config.agentTaskTimeoutMs / 1000)}s`));
      }
    }, config.agentTaskTimeoutMs);
  });
  const effort = config.reasoningEffort;
  runLoop(agent.getId(), message, {
    model: s.model,
    context,
    // Mozaik 4.2.0's Gemini adapter drops the `thoughtSignature` that Gemini 3 attaches to function calls, and the provider
    // then rejects the follow-up turn (HTTP 400, recorded in docs/traces). Tools are optional here (the arithmetic is done by
    // deterministic server code), so they are simply not offered to Gemini.
    tools: isGeminiModel(s.model) ? [] : (spec.tools ?? []),
    structuredOutput: { name: spec.schemaName, schema: providerJsonSchema(spec.schema, isGeminiModel(s.model) ? 'gemini' : 'strict-json-schema'), strict: true },
    ...(effort ? { reasoningEffort: effort } : {}),
  });
  try {
    return await answer;
  } finally {
    if (timer) clearTimeout(timer);
    const h = byContext.get(context.id);
    byContext.delete(context.id);
    if (h?.loopId) byLoop.delete(h.loopId);
  }
}

// ---------------------------------------------------------------- run completion

let idleTimer: NodeJS.Timeout | null = null;
let onIdle: (() => void) | null = null;
export function setIdleCallback(cb: () => void): void {
  onIdle = cb;
}

/** Called whenever work finishes. The run is complete only when nothing is in flight and nothing is debouncing. */
export function scheduleIdleCheck(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    const s = state();
    if (s.inFlight.size === 0 && s.timers.size === 0) onIdle?.();
  }, 1200);
}

export { camel as _camel };
export type { AgentRunRow };
