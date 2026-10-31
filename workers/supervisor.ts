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
import { parsePendingDocuments } from '../src/server/documents';
import { failRun, reapStaleRuns } from '../src/server/runs';

const WORKER_ID = `worker-${process.pid}-${randomUUID().slice(0, 6)}`;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_RUNS ?? 3);
const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 700);
// A freshly spawned run child must load TypeScript and the agent runtime before it can renew its own 60 s lease. On a
// small host (Render Free: 0.1 CPU) that alone takes longer than 60 s, so the first lease is longer; the child shortens it.
const START_LEASE_SECONDS = Number(process.env.RUN_START_LEASE_SECONDS ?? 300);
const children = new Map<string, ChildProcess>();
const runCases = new Map<string, string>();
let stopping = false;

async function claim(): Promise<{ id: string; case_id: string } | null> {
  return one<{ id: string; case_id: string }>(
    `update investigation_runs set status = 'running', started_at = now(), worker_id = $1, lease_expires_at = now() + make_interval(secs => $2)
     where id = (
       select r.id from investigation_runs r
       where r.status = 'queued'
         and not exists (select 1 from investigation_runs x where x.case_id = r.case_id and x.status = 'running')
         and not exists (select 1 from documents d where d.case_id = r.case_id and d.parse_status in ('queued','parsing'))
       order by r.queued_at limit 1 for update skip locked)
     returning id, case_id`,
    [WORKER_ID, START_LEASE_SECONDS],
  );
}

function spawnChild(runId: string, caseId: string) {
  const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('workers/run-child.ts'), runId], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' },
  });
  children.set(runId, child);
  runCases.set(runId, caseId);
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

async function reap() {
  await reapStaleRuns((id) => children.get(id)?.kill());
}

async function heartbeat() {
  await query(
    `insert into worker_heartbeats(worker_id, last_seen, running_runs, max_runs) values ($1, now(), $2, $3)
     on conflict (worker_id) do update set last_seen = now(), running_runs = $2, max_runs = $3`,
    [WORKER_ID, children.size, MAX_CONCURRENT],
  );
  await query("delete from worker_heartbeats where last_seen < now() - interval '1 day'");
}

async function tick() {
  try {
    await heartbeat();
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
  // The host is stopping this process (a deploy, or a free instance going to sleep). Say so now instead of leaving the
  // run "running" until its lease expires, so the person sees an honest state and can retry from the partial results.
  for (const [runId, caseId] of runCases) {
    await failRun(runId, caseId, 'worker_restarted', 'The server restarted while this investigation was running. Partial results were kept; you can retry.').catch(() => {});
  }
  await closePool().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
