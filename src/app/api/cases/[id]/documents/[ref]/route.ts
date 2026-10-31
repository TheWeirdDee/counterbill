import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/db/pool';
import { listFacts, listSpans } from '@/db/repo';
import { DOCUMENT_KINDS } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { documentOrThrow } from '@/server/case-actions';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; ref: string }> };

/** Document metadata with its citable spans and the facts that cite them. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id, ref } = await params;
  await requireCase(id);
  const doc = await documentOrThrow(id, ref);
  const spans = await listSpans(id, ref);
  const facts = (await listFacts(id, { includeInactive: true })).filter((f) => f.spanRefs.some((s) => s.startsWith(`${ref}-`)));
  return NextResponse.json({ document: doc, spans, facts });
});

export const PATCH = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id, ref } = await params;
  const a = await requireCase(id);
  if (a.demo) throw new ApiError(403, 'demo_readonly', 'Sample documents cannot be edited.');
  const { kind } = await readJson(req, z.object({ kind: z.enum(DOCUMENT_KINDS) }));
  await documentOrThrow(id, ref);
  await query('update documents set kind = $3, kind_set_by_user = true where case_id = $1 and ref = $2', [id, ref, kind]);
  return NextResponse.json({ ok: true });
});
