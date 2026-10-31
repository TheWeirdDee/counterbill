import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/db/pool';
import { camel } from '@/db/repo';
import { buildExports, storeExports } from '@/exports/build';
import { requireCase } from '@/server/access';
import { assertSameOrigin, rateLimit } from '@/server/auth';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireCase(id);
  const rows = await query('select id, kind, filename, draft_version, evidence_revision, size_bytes, reviewed, created_at from exports where case_id = $1 order by created_at desc', [id]);
  return NextResponse.json({ exports: rows.map((r) => camel(r)) });
});

/**
 * Builds the complaint PDF, the evidence-summary PDF and a CSV from the current draft. The explicit review
 * acknowledgement is required; raw uploaded documents are never included in an export.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  const a = await requireCase(id);
  await rateLimit(`export:${a.user?.id ?? id}`, 40, 3600);
  const body = await readJson(req, z.object({ reviewed: z.literal(true) }).catch(() => { throw new ApiError(422, 'review_required', 'Confirm that you have reviewed the facts before downloading.'); }));
  const built = await buildExports(id);
  const stored = await storeExports(id, built, body.reviewed);
  return NextResponse.json({ exports: stored, draftVersion: built.draftVersion, evidenceRevision: built.evidenceRevision, privacyNote: 'Source documents can contain names, addresses and payment details. Review who receives this pack before sharing it.' }, { status: 201 });
});
