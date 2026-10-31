/**
 * Case access. A private case belongs to exactly one user; a sample case belongs to the browser that created it.
 * Anything else answers 404 (never 403) so the existence of someone else's case is not revealed.
 */
import { cookies } from 'next/headers';
import { one } from '@/db/pool';
import { getCase, type CaseRow } from '@/db/repo';
import { currentUser, DEMO_COOKIE, sha, type User } from './auth';
import { ApiError, notFound } from './http';

export interface Access {
  case: CaseRow;
  user: User | null;
  demo: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireCase(caseId: string): Promise<Access> {
  if (!UUID.test(caseId)) throw notFound();
  const c = await getCase(caseId);
  if (!c) throw notFound();
  if (c.isDemo) {
    const token = (await cookies()).get(DEMO_COOKIE)?.value;
    const row = token ? await one<{ ok: boolean }>('select demo_token_hash = $2 as ok from cases where id = $1', [caseId, sha(token)]) : null;
    if (!row?.ok) throw notFound();
    return { case: c, user: null, demo: true };
  }
  const user = await currentUser();
  if (!user) throw new ApiError(401, 'unauthenticated', 'Please sign in.');
  if (c.ownerId !== user.id) throw notFound();
  return { case: c, user, demo: false };
}
