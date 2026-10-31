/**
 * Run control used by API routes: start, reassess (targeted), retry and cancel. Long-running work happens in
 * workers; these functions only record intent in the database (idempotently).
 */
import { one, pool, query, tx } from '@/db/pool';
import { activeOrQueuedRun, appendEvent, createRun, getCase, getRun, listDocuments, touchCase, type RunRow } from '@/db/repo';
import { AGENT_ROLES, type AgentRole } from '@/domain/schemas';
import { inferenceReadiness } from './config';

export class RunBlocked extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 409,
  ) {
    super(message);
  }
}

function requireReady() {
  const r = inferenceReadiness();
  if (!r.ready) throw new RunBlocked(r.code, r.message, 503);
  return r;
}

/** Idempotent: a second start while a run is queued/running returns that run. */
export async function startInvestigation(caseId: string): Promise<{ run: RunRow; existing: boolean }> {
  const readiness = requireReady();
  return tx(async (db) => {
    const c = await getCase(caseId, db);
    if (!c) throw new RunBlocked('not_found', 'Case not found', 404);
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const active = await activeOrQueuedRun(caseId, db);
    if (active) return { run: active, existing: true };
    const docs = await listDocuments(caseId, db);
    if (!docs.length) throw new RunBlocked('no_evidence', 'Add a document or describe the concern before starting.', 422);
    const run = await createRun(db, { caseId, kind: 'start', evidenceRevision: c.revision, trigger: { reason: 'Investigation started' }, inferenceMode: readiness.mode, model: readiness.model });
    await query("update cases set status = 'processing', updated_at = now() where id = $1", [caseId], db);
    await appendEvent({ caseId, runId: run.id, type: 'run.queued', producer: 'system', payload: { kind: 'start' }, evidenceRevision: c.revision, idempotencyKey: `${run.id}:run.queued` }, db);
    return { run, existing: false };
  });
}

/**
 * New or changed evidence. A queued reassessment is merged into; an active (now obsolete) run is cancelled so
 * it cannot write results for stale evidence.
 */
export async function requestReassess(
  caseId: string,
  args: { reason: string; documentRefs?: string[]; targetedAgents?: AgentRole[]; event?: { type: string; payload: Record<string, unknown> } },
): Promise<RunRow | null> {
  const readiness = inferenceReadiness();
  return tx(async (db) => {
    const c = await getCase(caseId, db);
    if (!c) return null;
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const everRan = await one<{ n: string }>("select count(*) as n from investigation_runs where case_id = $1 and status <> 'queued'", [caseId], db);
    const queued = await one("select * from investigation_runs where case_id = $1 and status = 'queued' order by queued_at desc limit 1", [caseId], db);
    if (!readiness.ready) {
      // Nothing can run; the evidence is stored and the user is told why on the next start attempt.
      return null;
    }
    if (queued) {
      const q = queued as { id: string; trigger: { documentRefs?: string[]; events?: { type: string; payload: Record<string, unknown> }[] } };
      const merged = [...new Set([...(q.trigger.documentRefs ?? []), ...(args.documentRefs ?? [])])];
      const events = [...(q.trigger.events ?? []), ...(args.event ? [args.event] : [])];
      await query('update investigation_runs set trigger = $2, evidence_revision = $3 where id = $1', [q.id, JSON.stringify({ reason: args.reason, documentRefs: merged, events }), c.revision], db);
      return getRun(q.id, db);
    }
    if (Number(everRan?.n ?? 0) === 0) return null; // case not started yet: the user starts it explicitly
    const active = await one<{ id: string }>("select id from investigation_runs where case_id = $1 and status = 'running'", [caseId], db);
    if (active) {
      await query("update investigation_runs set cancel_requested = true, cancel_reason = 'Superseded by newer evidence' where id = $1", [active.id], db);
    }
    const run = await createRun(db, {
      caseId,
      kind: 'reassess',
      evidenceRevision: c.revision,
      trigger: { reason: args.reason, documentRefs: args.documentRefs ?? [], events: args.event ? [args.event] : [] },
      targetedAgents: args.targetedAgents ?? [],
      inferenceMode: readiness.mode,
      model: readiness.model,
      parentRunId: active?.id ?? null,
    });
    await query("update cases set status = 'processing', updated_at = now() where id = $1", [caseId], db);
    await appendEvent({ caseId, runId: run.id, type: 'run.queued', producer: 'system', payload: { kind: 'reassess', reason: args.reason, documentRefs: args.documentRefs ?? [] }, evidenceRevision: c.revision, idempotencyKey: `${run.id}:run.queued` }, db);
    return run;
  });
}

/** Re-run only the roles that failed (the worker then flows downstream through events as usual). */
export async function retryFailed(caseId: string): Promise<RunRow> {
  const readiness = requireReady();
  return tx(async (db) => {
    const c = await getCase(caseId, db);
    if (!c) throw new RunBlocked('not_found', 'Case not found', 404);
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const active = await activeOrQueuedRun(caseId, db);
    if (active) return active;
    const last = await one<{ id: string }>("select id from investigation_runs where case_id = $1 and status in ('partial','failed') order by queued_at desc limit 1", [caseId], db);
    if (!last) throw new RunBlocked('nothing_to_retry', 'There is no failed run to retry.', 422);
    const failedRoles = (
      await query<{ agent_role: string }>("select distinct agent_role from agent_runs where run_id = $1 and status = 'failed'", [last.id], db)
    )
      .map((r) => r.agent_role as AgentRole)
      .filter((r) => (AGENT_ROLES as readonly string[]).includes(r));
    const targeted = failedRoles.length ? failedRoles : [];
    const run = await createRun(db, { caseId, kind: 'retry', evidenceRevision: c.revision, trigger: { reason: 'Retry after failure', retryOf: last.id }, targetedAgents: targeted, inferenceMode: readiness.mode, model: readiness.model, parentRunId: last.id });
    await query("update cases set status = 'processing', updated_at = now() where id = $1", [caseId], db);
    await appendEvent({ caseId, runId: run.id, type: 'run.queued', producer: 'system', payload: { kind: 'retry', targeted }, evidenceRevision: c.revision, idempotencyKey: `${run.id}:run.queued` }, db);
    return run;
  });
}

export async function cancelActiveRun(caseId: string): Promise<boolean> {
  const rows = await query(
    `update investigation_runs set cancel_requested = true, cancel_reason = 'Cancelled by user',
       status = case when status = 'queued' then 'cancelled' else status end, finished_at = case when status = 'queued' then now() else finished_at end
     where case_id = $1 and status in ('queued','running') returning id`,
    [caseId],
  );
  if (rows.length) await touchCase(pool(), caseId);
  return rows.length > 0;
}

/** Marks a running run as failed (worker crashed or lease expired) and tells the user how to recover. */
export async function failRun(runId: string, caseId: string, code: string, message: string): Promise<boolean> {
  const row = await one<{ evidence_revision: number }>(
    `update investigation_runs set status = 'failed', finished_at = now(), error_code = $2, error_message = $3, lease_expires_at = null
     where id = $1 and status = 'running' returning evidence_revision`,
    [runId, code, message],
  );
  if (!row) return false;
  await query("update cases set status = 'failed', updated_at = now() where id = $1", [caseId]);
  await appendEvent({ caseId, runId, type: 'run.failed', producer: 'system', payload: { code, message }, evidenceRevision: row.evidence_revision, idempotencyKey: `${runId}:run.failed:${code}` });
  return true;
}

/** Runs whose lease expired have no live worker. Returns the ids that were failed. */
export async function reapStaleRuns(onReap?: (runId: string) => void): Promise<string[]> {
  const stale = await query<{ id: string; case_id: string }>("select id, case_id from investigation_runs where status = 'running' and lease_expires_at < now()");
  const out: string[] = [];
  for (const s of stale) {
    onReap?.(s.id);
    if (await failRun(s.id, s.case_id, 'worker_lost', 'The worker stopped responding. Partial results were kept; you can retry.')) out.push(s.id);
  }
  return out;
}
