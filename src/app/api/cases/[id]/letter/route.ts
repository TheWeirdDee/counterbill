import { NextResponse } from 'next/server';
import { currentDraft, listDrafts, pendingProposal } from '@/db/repo';
import { LetterPatchInput } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { editLetter } from '@/server/case-actions';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const a = await requireCase(id);
  const draft = await currentDraft(id);
  return NextResponse.json({ draft, proposal: await pendingProposal(id), history: (await listDrafts(id)).map((d) => ({ version: d.version, status: d.status, createdBy: d.createdBy, changeSummary: d.changeSummary, createdAt: d.createdAt })), stale: !!draft && draft.evidenceRevision < a.case.revision });
});

/** Conditional write: `baseVersion` must be the current version or the edit is refused (409), never merged silently. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  const a = await requireCase(id);
  if (a.demo && !a.case.isDemo) throw new ApiError(403, 'demo_readonly', 'Not allowed.');
  const body = await readJson(req, LetterPatchInput);
  const draft = await editLetter(id, body.baseVersion, body.sections);
  return NextResponse.json({ draft });
});
