import { NextResponse } from 'next/server';
import { listCalculations, listFindings } from '@/db/repo';
import { requireCase } from '@/server/access';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireCase(id);
  return NextResponse.json({ findings: await listFindings(id, { includeSuperseded: true }), calculations: await listCalculations(id, { all: true }) });
});
