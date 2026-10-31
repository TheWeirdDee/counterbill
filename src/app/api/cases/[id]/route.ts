import { NextResponse } from 'next/server';
import { z } from 'zod';
import { query } from '@/db/pool';
import { getCase } from '@/db/repo';
import { SHIPMENT_CLASSES } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin } from '@/server/auth';
import { deleteCase } from '@/server/case-actions';
import { buildCaseState } from '@/server/case-state';
import { ApiError, readJson, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  const a = await requireCase(id);
  return NextResponse.json(await buildCaseState(a.case, { role: a.demo ? 'demo' : 'owner' }), { headers: { 'Cache-Control': 'no-store' } });
});

const Patch = z.object({
  expectedRevision: z.number().int(),
  name: z.string().trim().min(1).max(160).optional(),
  claimant: z.string().trim().max(160).optional(),
  counterparty: z.string().trim().max(160).optional(),
  origin: z.string().trim().max(120).optional(),
  destination: z.string().trim().max(120).optional(),
  shipmentClass: z.enum(SHIPMENT_CLASSES).optional(),
  archived: z.boolean().optional(),
});

/** Header edits are metadata only: they do not change the evidence revision or restart any agent. */
export const PATCH = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  const a = await requireCase(id);
  if (a.demo) throw new ApiError(403, 'demo_readonly', 'Sample cases cannot be edited.');
  const p = await readJson(req, Patch);
  if (p.expectedRevision !== a.case.revision) throw new ApiError(409, 'revision_conflict', 'The case changed since you opened it. Refresh and try again.', true);
  await query(
    `update cases set name = coalesce($2, name), claimant = coalesce($3, claimant), counterparty = coalesce($4, counterparty), origin = coalesce($5, origin),
       destination = coalesce($6, destination), shipment_class = coalesce($7, shipment_class), archived = coalesce($8, archived),
       status = case when $8 = true then 'archived' when $8 = false and status = 'archived' then 'draft' else status end, updated_at = now() where id = $1`,
    [id, p.name ?? null, p.claimant ?? null, p.counterparty ?? null, p.origin ?? null, p.destination ?? null, p.shipmentClass ?? null, p.archived ?? null],
  );
  return NextResponse.json({ ok: true, case: await getCase(id) });
});

export const DELETE = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  await requireCase(id);
  await deleteCase(id);
  return NextResponse.json({ ok: true });
});
