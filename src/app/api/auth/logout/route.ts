import { NextResponse } from 'next/server';
import { assertSameOrigin, destroySession } from '@/server/auth';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  await destroySession();
  return NextResponse.json({ ok: true });
});
