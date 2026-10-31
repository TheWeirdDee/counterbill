import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { assertSameOrigin, DEMO_COOKIE, rateLimit, sha } from '@/server/auth';
import { config } from '@/server/config';
import { createDemoCaseInstance, getDemoCase } from '@/server/demo';
import { ApiError, clientIp, route } from '@/server/http';
import { startInvestigation } from '@/server/runs';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ slug: string }> };

/**
 * Starts a fresh, isolated sample investigation. The visitor's browser gets a random token; only that browser
 * can read or act on the case it created. Runs are rate-limited per IP to bound model spend.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { slug } = await params;
  if (!getDemoCase(slug)) throw new ApiError(404, 'not_found', 'Unknown sample case.');
  await rateLimit(`demo-run:${clientIp(req)}`, config.demoRunsPerIpPerHour, 3600);
  const jar = await cookies();
  let token = jar.get(DEMO_COOKIE)?.value;
  if (!token) {
    token = randomBytes(24).toString('base64url');
    jar.set(DEMO_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/', maxAge: 7 * 86400 });
  }
  // Refuse before creating anything when the model is not configured, so no empty case is left behind.
  const { inferenceReadiness } = await import('@/server/config');
  const r = inferenceReadiness();
  if (!r.ready) throw new ApiError(503, r.code, r.message, true);
  const c = await createDemoCaseInstance(slug, sha(token));
  const { run } = await startInvestigation(c.id);
  return NextResponse.json({ caseId: c.id, runId: run.id, url: `/examples/${slug}/${c.id}` }, { status: 202 });
});
