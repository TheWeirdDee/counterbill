import { NextResponse } from 'next/server';
import { readiness } from '@/server/readiness';

export const dynamic = 'force-dynamic';

/**
 * Liveness: 200 while the process and the database answer, 503 when the database does not. The body also says whether
 * the app is actually usable (`ready`, and why not), because a hosting platform should keep a process that is merely
 * waiting for a credential, while a person or monitor should still be told. See /api/ready for the strict check.
 * Never returns secret values.
 */
export async function GET() {
  const r = await readiness();
  return NextResponse.json({ ok: r.live, ...r }, { status: r.live ? 200 : 503 });
}
