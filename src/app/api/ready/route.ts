import { NextResponse } from 'next/server';
import { readiness } from '@/server/readiness';

export const dynamic = 'force-dynamic';

/** Strict readiness: 503 unless the database, a recent worker heartbeat and a model credential are all present. */
export async function GET() {
  const r = await readiness();
  return NextResponse.json(r, { status: r.ready ? 200 : 503 });
}
