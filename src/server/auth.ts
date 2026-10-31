/**
 * Accounts and sessions. Passwords use scrypt; sessions are random tokens stored only as SHA-256 hashes, delivered in
 * an httpOnly SameSite=Lax cookie. Mutating requests must come from the same origin (CSRF defence for cookie auth).
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { one, query } from '@/db/pool';
import { config } from './config';
import { ApiError } from './http';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const SESSION_COOKIE = 'cb_session';
export const DEMO_COOKIE = 'cb_demo';
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  displayName: string;
  organizationName: string;
  contactDetails: string;
}

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const dk = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${dk.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const dk = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(hashHex, 'hex');
  return dk.length === want.length && timingSafeEqual(dk, want);
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  await query("insert into sessions(token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))", [sha(token), userId, SESSION_DAYS]);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.isProduction, path: '/', maxAge: SESSION_DAYS * 86400 });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await query('delete from sessions where token_hash = $1', [sha(token)]);
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await one<{ id: string; email: string; display_name: string; organization_name: string; contact_details: string }>(
    `select u.id, u.email, u.display_name, u.organization_name, u.contact_details from sessions s join users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [sha(token)],
  );
  return row ? { id: row.id, email: row.email, displayName: row.display_name, organizationName: row.organization_name, contactDetails: row.contact_details } : null;
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new ApiError(401, 'unauthenticated', 'Please sign in.');
  return u;
}

/** Browsers always send Origin on cross-site POSTs; reject when it does not match this host. */
export function assertSameOrigin(req: Request): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (!origin) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (new URL(origin).host !== host) throw new ApiError(403, 'bad_origin', 'Cross-site requests are not allowed.');
}

/** Fixed-window rate limit backed by the database (works across web instances). */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const row = await one<{ count: number }>(
    `insert into rate_limits(key, window_start, count) values ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     on conflict (key, window_start) do update set count = rate_limits.count + 1 returning count`,
    [key, windowSeconds],
  );
  if (row && row.count > limit) throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a little and try again.', true);
}
