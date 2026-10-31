import { NextResponse } from 'next/server';
import { listDocuments } from '@/db/repo';
import { UploadRejected } from '@/docs/parse';
import { DOCUMENT_KINDS, type DocumentKind } from '@/domain/schemas';
import { requireCase } from '@/server/access';
import { assertSameOrigin, rateLimit } from '@/server/auth';
import { config } from '@/server/config';
import { addDocument } from '@/server/documents';
import { ApiError, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireCase(id);
  return NextResponse.json({ documents: await listDocuments(id) });
});

/**
 * Authenticated multipart upload. Documents are stored privately in the database and queued for parsing by the
 * worker; this handler never parses or calls a model. Replace an existing document with `supersedes=D2`.
 */
export const POST = route(async (req: Request, { params }: Ctx) => {
  assertSameOrigin(req);
  const { id } = await params;
  const a = await requireCase(id);
  if (a.demo) throw new ApiError(403, 'demo_readonly', 'Sample cases accept only the published evidence offered on the page.');
  await rateLimit(`upload:${a.user!.id}`, 120, 3600);
  const form = await req.formData();
  const files = form.getAll('file').filter((f): f is File => f instanceof File);
  if (!files.length) throw new ApiError(422, 'no_file', 'Choose at least one file.');
  const kinds = form.getAll('kind').map(String);
  const supersedes = form.get('supersedes') ? String(form.get('supersedes')) : null;
  const created = [];
  const rejected: { filename: string; code: string; message: string }[] = [];
  for (const [i, f] of files.entries()) {
    const kind = kinds[i] && (DOCUMENT_KINDS as readonly string[]).includes(kinds[i]) ? (kinds[i] as DocumentKind) : undefined;
    try {
      if (f.size > config.maxFileBytes) throw new UploadRejected('too_large', `"${f.name}" is larger than ${Math.round(config.maxFileBytes / 1024 / 1024)} MB.`);
      created.push(await addDocument(id, { filename: f.name, bytes: Buffer.from(await f.arrayBuffer()), kind, supersedesRef: supersedes }));
    } catch (e) {
      if (e instanceof UploadRejected) rejected.push({ filename: f.name, code: e.code, message: e.message });
      else throw e;
    }
  }
  if (!created.length) throw new ApiError(422, rejected[0]?.code ?? 'rejected', rejected[0]?.message ?? 'No file was accepted.', false, rejected);
  return NextResponse.json({ documents: created, rejected }, { status: 201 });
});
