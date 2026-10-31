/**
 * Worker supervisor. Long-running work never happens in request handlers:
 *  - parses uploaded documents (separate job type from investigations),
 *  - claims queued investigation runs (leases, at most one running run per case) and spawns ONE child process per run,
 *  - reaps runs whose worker disappeared so the user gets a failed run with a retry path instead of a hung one.
 * Run it with `pnpm worker` (and `pnpm dev` starts it next to Next.js).
 */
import 'dotenv/config';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { migrate } from '../src/db/migrate';
import { closePool, one, query } from '../src/db/pool';
import { appendEvent } from '../src/db/repo';
import { parsePendingDocuments } from '../src/server/documents';

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 6)}`;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_RUNS ?? 3);
const TICK_MS = 700;
const children = new Map<string, ChildProcess>();
let stopping = false;

async function claim(): Promise<{ id: string; case_id: string } | null> {
  return one<{ id: string; case_id: string }>(
    `update investigation_runs set status = 'running', started_at = now(), worker_id = $1, lease_expires_at = now() + interval '60 seconds'
     where id = (
       select r.id from investigation_runs r
       where r.status = 'queued'
         and not exists (select 1 from investigation_runs x where x.case_id = r.case_id and x.status = 'running')
         and not exists (select 1 from documents d where d.case_id = r.case_id and d.parse_status in ('queued','parsing'))
       order by r.queued_at limit 1 for update skip locked)
     returning id, case_id`,
    [WORKER_ID],
  );
}

function spawnChild(runId: string, caseId: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('workers/run-child.ts'), runId], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
  });
  children.set(runId, child);
  console.log(`[supervisor] run ${runId.slice(0, 8)} started (pid ${child.pid})`);
  child.on('exit', async (code, signal) => {
    children.delete(runId);
    const row = await one<{ status: string }>('select status from investigation_runs where id = $1', [runId]).catch(() => null);
    if (row?.status === 'running') {
      await failRun(runId, caseId, 'worker_crashed', `The worker process ended unexpectedly (code ${code ?? signal}). Partial results were kept.`);
    }
    console.log(`[supervisor] run ${runId.slice(0, 8)} exited (${row?.status ?? '?'})`);
  });
}

async function failRun(runId: string, caseId: string, code: string, message: string) {
  const r = await one<{ evidence_revision: number }>(
    `update investigation_runs set status = 'failed', finished_at = now(), error_code = $2, error_message = $3, lease_expires_at = null
     where id = $1 and status = 'running' returning evidence_revision`,
    [runId, code, message],
  );
  if (!r) return;
  await query("update cases set status = 'failed', updated_at = now() where id = $1", [caseId]);
  await appendEvent({ caseId, runId, type: 'run.failed', producer: 'system', payload: { code, message }, evidenceRevision: r.evidence_revision, idempotencyKey: `${runId}:run.failed:${code}` });
}

async function reap() {
  const stale = await query<{ id: string; case_id: string }>("select id, case_id from investigation_runs where status = 'running' and lease_expires_at < now()");
  for (const s of stale) {
    children.get(s.id)?.kill();
    await failRun(s.id, s.case_id, 'worker_lost', 'The worker stopped responding. Partial results were kept; you can retry.');
  }
}

async function tick() {
  try {
    await parsePendingDocuments(5);
    await reap();
    while (!stopping && children.size < MAX_CONCURRENT) {
      const run = await claim();
      if (!run) break;
      spawnChild(run.id, run.case_id);
    }
  } catch (e) {
    console.error('[supervisor] tick error:', (e as Error).message);
  }
}

await migrate((m) => console.log(`[supervisor] migration ${m}`));
console.log(`[supervisor] ${WORKER_ID} ready (max ${MAX_CONCURRENT} concurrent runs)`);
const timer = setInterval(() => void tick(), TICK_MS);

async function shutdown() {
  stopping = true;
  clearInterval(timer);
  for (const c of children.values()) c.kill();
  await closePool().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
