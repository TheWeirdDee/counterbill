import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { addDemoEvidence } from '@/server/demo';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Adds one of the published evidence steps to a sample case; the worker then reassesses only what it affects. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  const a = await requireCase(id);
  if (!a.demo) throw new ApiError(403, 'not_a_sample', 'Only sample cases offer published evidence steps.');
  const { stepId } = await readJson(req, z.object({ stepId: z.string().max(40) }));
  return NextResponse.json(await addDemoEvidence(id, stepId), { status: 202 });
});
