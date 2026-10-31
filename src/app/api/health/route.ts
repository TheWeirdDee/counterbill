import { NextResponse } from 'next/server';
import { one } from '@/db/pool';
import { inferenceReadiness } from '@/server/config';

export const dynamic = 'force-dynamic';

/** Readiness probe. Never returns secret values: only whether the database and a model credential are configured. */
export async function GET() {
  let db = false;
  try {
    db = !!(await one('select 1 as ok'));
  } catch {
    db = false;
  }
  const r = inferenceReadiness();
  const queued = db ? await one<{ n: string }>("select count(*) as n from investigation_runs where status = 'queued' and queued_at < now() - interval '30 seconds'") : null;
  return NextResponse.json(
    {
      ok: db,
      database: db,
      inference: r.ready ? { ready: true, mode: r.mode, model: r.model } : { ready: false, code: r.code, message: r.message },
      stalledQueuedRuns: Number(queued?.n ?? 0),
    },
    { status: db ? 200 : 503 },
  );
}
