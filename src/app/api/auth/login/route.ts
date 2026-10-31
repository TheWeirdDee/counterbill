import { NextResponse } from 'next/server';
import { one } from '@/db/pool';
import { AuthInput } from '@/domain/schemas';
import { assertSameOrigin, createSession, rateLimit, verifyPassword } from '@/server/auth';
import { ApiError, clientIp, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const input = await readJson(req, AuthInput.pick({ email: true, password: true }));
  await rateLimit(`login:${clientIp(req)}:${input.email}`, 10, 900);
  const row = await one<{ id: string; password_hash: string }>('select id, password_hash from users where email = $1', [input.email]);
  // Same message for unknown email and wrong password.
  if (!row || !(await verifyPassword(input.password, row.password_hash))) throw new ApiError(401, 'bad_credentials', 'That email and password do not match.');
  await createSession(row.id);
  return NextResponse.json({ ok: true });
});
