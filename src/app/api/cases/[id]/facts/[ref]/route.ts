import { NextResponse } from 'next/server';
import { FactCorrectionInput } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { correctFact } from '@/server/case-actions';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; ref: string }> };

/** A correction never edits the original extraction: it records a new user-corrected fact and supersedes the old one. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id, ref } = await params;
  const a = await requireCase(id);
  if (a.demo) throw new ApiError(403, 'demo_readonly', 'Sample cases cannot be edited.');
  const result = await correctFact(id, ref, await readJson(req, FactCorrectionInput));
  return NextResponse.json(result);
});
