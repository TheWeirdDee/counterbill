import { NextResponse } from 'next/server';
import { one } from '@/db/pool';
import { AuthInput } from '@/domain/schemas';
import { assertSameOrigin, createSession, hashPassword, rateLimit } from '@/server/auth';
import { ApiError, clientIp, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimit(`signup:${clientIp(req)}`, 10, 3600);
  const input = await readJson(req, AuthInput);
  const exists = await one('select 1 from users where email = $1', [input.email]);
  if (exists) throw new ApiError(409, 'email_taken', 'An account with that email already exists. Try signing in.');
  const hash = await hashPassword(input.password);
  const user = await one<{ id: string }>('insert into users(email, password_hash, display_name) values ($1,$2,$3) returning id', [input.email, hash, input.displayName || input.email.split('@')[0]]);
  await createSession(user!.id);
  return NextResponse.json({ ok: true });
});
