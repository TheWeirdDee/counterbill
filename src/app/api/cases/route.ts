import { NextResponse } from 'next/server';
import { createCase, listCasesForOwner } from '@/db/repo';
import { CreateCaseInput } from '@/domain/schemas';
import { assertSameOrigin, rateLimit, requireUser } from '@/server/auth';
import { addDocument, parseQueuedDocument } from '@/server/documents';
import { readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async (req: Request) => {
  const user = await requireUser();
  const q = new URL(req.url).searchParams.get('q')?.trim() || undefined;
  const cases = await listCasesForOwner(user.id, q);
  const counts = {
    active: cases.filter((c) => c.status === 'processing').length,
    needsInput: cases.filter((c) => c.status === 'needs_input').length,
    reviewReady: cases.filter((c) => c.status === 'review_ready').length,
  };
  return NextResponse.json({ cases, counts });
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser();
  await rateLimit(`create-case:${user.id}`, 60, 3600);
  const input = await readJson(req, CreateCaseInput);
  const c = await createCase({ ...input, name: input.name, status: 'draft' }, { ownerId: user.id });
  const statement = [
    input.concern ? `My concern: ${input.concern}` : '',
    input.billedAmount ? `Billed amount stated by me: ${input.currency} ${input.billedAmount}` : '',
    input.shipmentClass !== 'unknown' ? `Shipment type: ${input.shipmentClass}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  if (statement) {
    const doc = await addDocument(c.id, { filename: 'Your description of the concern.txt', bytes: Buffer.from(statement, 'utf8'), kind: 'user_statement', sourceClass: 'user_statement', sourceLabel: 'Your statement (user-provided, not verified)' });
    await parseQueuedDocument(c.id, doc.ref);
  }
  return NextResponse.json({ caseId: c.id, status: c.status }, { status: 201 });
});
