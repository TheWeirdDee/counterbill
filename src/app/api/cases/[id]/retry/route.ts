import { NextResponse } from 'next/server';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { route } from '@/server/http';
import { retryFailed } from '@/server/runs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Re-run only the agents that failed. Findings already produced are kept; nothing is duplicated. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  await requireCase(id);
  const run = await retryFailed(id);
  return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
});
