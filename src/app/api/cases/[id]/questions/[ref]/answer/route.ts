import { NextResponse } from 'next/server';
import { AnswerInput } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { answerQuestion } from '@/server/case-actions';
import { readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; ref: string }> };

/** An answer becomes a user statement (clearly not a verified third-party fact) and triggers a targeted reassessment. */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id, ref } = await params;
  await requireCase(id);
  const result = await answerQuestion(id, ref, await readJson(req, AnswerInput));
  return NextResponse.json(result, { status: 202 });
});
