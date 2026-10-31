import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listDocuments } from '@/db/repo';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { readJson, route } from '@/server/http';
import { requestReassess } from '@/server/runs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

/** Manually request a reassessment of the documents added since the last run (normally this happens automatically). */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  await requireCase(id);
  const body = await readJson(req, z.object({ reason: z.string().max(200).optional() }));
  const docs = await listDocuments(id);
  const run = await requestReassess(id, { reason: body.reason ?? 'Reassessment requested', documentRefs: docs.filter((d) => d.parseStatus === 'ready').map((d) => d.ref).slice(-3) });
  return NextResponse.json({ runId: run?.id ?? null, queued: !!run }, { status: run ? 202 : 200 });
});
