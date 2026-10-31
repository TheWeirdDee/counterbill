import { NextResponse } from 'next/server';
import { requireCase } from '@/server/access';
import { assertSameOrigin, rateLimit } from '@/server/auth';
import { route } from '@/server/http';
import { startInvestigation } from '@/server/runs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Idempotent: starting twice returns the run that is already queued or running. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  const a = await requireCase(id);
  await rateLimit(`start:${a.user?.id ?? id}`, 30, 3600);
  const { run, existing } = await startInvestigation(id);
  return NextResponse.json({ runId: run.id, existing, status: run.status }, { status: existing ? 200 : 202 });
});
