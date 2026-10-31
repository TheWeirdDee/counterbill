import { getBlob } from '@/db/repo';
import { requireCase } from '@/server/access';
import { documentOrThrow } from '@/server/case-actions';
import { ApiError, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; ref: string }> };

/** The original bytes, served only to the case's owner, never cached, never sniffed. */
export const GET = route(async (_req: Request, { params }: Ctx) => {
  const { id, ref } = await params;
  await requireCase(id);
  const doc = await documentOrThrow(id, ref);
  const bytes = doc.storageKey ? await getBlob(id, doc.storageKey) : null;
  if (!bytes) throw new ApiError(404, 'not_found', 'The stored file is missing.');
  const inline = doc.mime === 'application/pdf' || doc.mime.startsWith('image/');
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': inline || doc.mime.startsWith('text/') ? doc.mime : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${doc.originalFilename.replace(/[^\w. -]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
