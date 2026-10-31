import { NextResponse } from 'next/server';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { route } from '@/server/http';
import { cancelActiveRun } from '@/server/runs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  await requireCase(id);
  return NextResponse.json({ cancelled: await cancelActiveRun(id) });
});
