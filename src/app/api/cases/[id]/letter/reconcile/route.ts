import { NextResponse } from 'next/server';
import { ReconcileInput } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { reconcileLetter } from '@/server/case-actions';
import { readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  await requireCase(id);
  const body = await readJson(req, ReconcileInput);
  return NextResponse.json({ draft: await reconcileLetter(id, body.proposalVersion, body.decisions) });
});
