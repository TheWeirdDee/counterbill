/**
 * What "ready" means for this deployment: the database answers, a worker has reported in recently, a model credential
 * is configured, and queued investigations are not piling up. `/api/health` is liveness (the process and database);
 * `/api/ready` returns 503 unless every one of these holds, so a monitor sees an unusable app as unusable.
 */
import { one } from '@/db/pool';
import { inferenceReadiness } from './config';

export const WORKER_FRESH_SECONDS = 15;

export interface Readiness {
  live: boolean;
  ready: boolean;
  database: boolean;
  worker: { alive: boolean; lastSeenSeconds: number | null; runningRuns: number; maxRuns: number };
  inference: { ready: true; mode: 'live' | 'test'; model: string } | { ready: false; code: string; message: string };
  stalledQueuedRuns: number;
  reasons: string[];
}

export async function readiness(): Promise<Readiness> {
  let database = false;
  try {
    database = !!(await one('select 1 as ok'));
  } catch {
    database = false;
  }
  const inf = inferenceReadiness();
  const inference = inf.ready ? ({ ready: true, mode: inf.mode, model: inf.model } as const) : ({ ready: false, code: inf.code, message: inf.message } as const);
  let worker: Readiness['worker'] = { alive: false, lastSeenSeconds: null, runningRuns: 0, maxRuns: 0 };
  let stalled = 0;
  if (database) {
    const w = await one<{ age: number; running_runs: number; max_runs: number }>(
      'select extract(epoch from now() - last_seen)::float as age, running_runs, max_runs from worker_heartbeats order by last_seen desc limit 1',
    ).catch(() => null);
    if (w) worker = { alive: w.age <= WORKER_FRESH_SECONDS, lastSeenSeconds: Math.round(w.age), runningRuns: w.running_runs, maxRuns: w.max_runs };
    const q = await one<{ n: string }>("select count(*) as n from investigation_runs where status = 'queued' and queued_at < now() - interval '30 seconds'").catch(() => null);
    stalled = Number(q?.n ?? 0);
  }
  const reasons: string[] = [];
  if (!database) reasons.push('database is not reachable');
  if (database && !worker.alive) reasons.push(worker.lastSeenSeconds === null ? 'no worker has reported in' : `worker last seen ${worker.lastSeenSeconds}s ago`);
  if (!inference.ready) reasons.push(`model not configured: ${inference.code}`);
  if (stalled > 0) reasons.push(`${stalled} queued investigation(s) waiting more than 30 s`);
  return { live: database, ready: reasons.length === 0, database, worker, inference, stalledQueuedRuns: stalled, reasons };
}
