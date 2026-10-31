import { NextResponse } from 'next/server';
import { ChallengeInput } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { challengeFinding } from '@/server/case-actions';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; ref: string }> };

/** The reason is stored as a user statement (citable evidence) and pushed to the Contract and Case agents. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id, ref } = await params;
  const a = await requireCase(id);
  if (a.demo && !a.case.isDemo) throw new ApiError(403, 'demo_readonly', 'Not allowed.');
  const result = await challengeFinding(id, ref, await readJson(req, ChallengeInput));
  return NextResponse.json(result, { status: 202 });
});
