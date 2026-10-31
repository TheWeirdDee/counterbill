import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/db/pool';
import { assertSameOrigin, destroySession, requireUser, verifyPassword } from '@/server/auth';
import { deleteAccount } from '@/server/case-actions';
import { ApiError, readJson, route } from '@/server/http';
import { one } from '@/db/pool';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await requireUser();
  const counts = await one<{ cases: string }>('select count(*) as cases from cases where owner_id = $1', [user.id]);
  return NextResponse.json({ user, caseCount: Number(counts?.cases ?? 0) });
});

const Patch = z.object({
  displayName: z.string().trim().max(120).optional(),
  organizationName: z.string().trim().max(160).optional(),
  contactDetails: z.string().trim().max(600).optional(),
});

export const PATCH = route(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const p = await readJson(req, Patch);
  await query(
    'update users set display_name = coalesce($2, display_name), organization_name = coalesce($3, organization_name), contact_details = coalesce($4, contact_details) where id = $1',
    [user.id, p.displayName ?? null, p.organizationName ?? null, p.contactDetails ?? null],
  );
  return NextResponse.json({ ok: true });
});

const Del = z.object({ password: z.string().min(1), confirm: z.literal('DELETE') });

/** Deletes the account, every case, every stored document and every export. */
export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const body = await readJson(req, Del);
  const row = await one<{ password_hash: string }>('select password_hash from users where id = $1', [user.id]);
  if (!row || !(await verifyPassword(body.password, row.password_hash))) throw new ApiError(403, 'bad_credentials', 'That password is not correct.');
  const cases = await deleteAccount(user.id);
  await destroySession();
  return NextResponse.json({ ok: true, casesDeleted: cases });
});
