import { NextResponse } from 'next/server';
import { listAgentRuns, listEvents, listRuns } from '@/db/repo';
import { requireCase } from '@/server/access';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/**
 * Sanitised trace for verification: runs, per-agent Mozaik loop ids with start/finish times, and the persisted
 * event log (agent, type, time, causation). It contains no prompts, document text, model answers or secrets.
 */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const a = await requireCase(id);
  const [runs, agentRuns, events] = await Promise.all([listRuns(id), listAgentRuns(id), listEvents(id, 0, 5000)]);
  const trace = {
    note: 'Observed values from the Mozaik runtime and the Counterbill event log. Prompts, document text and model answers are not included.',
    exportedAt: new Date().toISOString(),
    case: { id: a.case.id, name: a.case.name, evidenceRevision: a.case.revision, sample: a.case.sampleLabel },
    runs: runs.map((r) => ({ id: r.id, kind: r.kind, status: r.status, inferenceMode: r.inferenceMode, model: r.model, evidenceRevision: r.evidenceRevision, queuedAt: r.queuedAt, startedAt: r.startedAt, finishedAt: r.finishedAt, modelCalls: r.modelCalls, errorCode: r.errorCode, trigger: r.trigger })),
    agentRuns: agentRuns.map((t) => ({ runId: t.runId, role: t.agentRole, task: t.taskLabel, mozaikAgentId: t.mozaikAgentId, mozaikLoopId: t.mozaikLoopId, attempt: t.attempt, status: t.status, evidenceRevision: t.evidenceRevision, startedAt: t.startedAt, inferenceStartedAt: t.inferenceStartedAt, inferenceFinishedAt: t.inferenceFinishedAt, finishedAt: t.finishedAt, tokens: t.inputTokens != null ? { input: t.inputTokens, output: t.outputTokens } : null, triggerEventId: t.triggerEventId, error: t.error })),
    events: events.map((e) => ({ seq: Number(e.seq), id: e.id, runId: e.runId, type: e.type, producer: e.producer, occurredAt: e.occurredAt, causationId: e.causationId, evidenceRevision: e.evidenceRevision, payload: e.payload })),
  };
  return new NextResponse(JSON.stringify(trace, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="counterbill-trace-${id.slice(0, 8)}.json"`, 'Cache-Control': 'no-store' } });
});
