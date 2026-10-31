import { NextResponse } from 'next/server';
import { z } from 'zod';
import { FACT_KEYS } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { addManualFact } from '@/server/case-actions';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({
  key: z.enum(FACT_KEYS),
  value: z.string().trim().min(1).max(300),
  unit: z.string().trim().max(20).nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  subject: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(500).optional(),
});

/** Manual entry: the fallback when a document cannot be read. Recorded as a user statement, never as a verified fact. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  const a = await requireCase(id);
  if (a.demo) throw new ApiError(403, 'demo_readonly', 'Sample cases cannot be edited.');
  const fact = await addManualFact(id, await readJson(req, Body));
  return NextResponse.json({ fact }, { status: 201 });
});
