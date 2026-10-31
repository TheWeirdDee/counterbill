import { loadExport } from '@/exports/build';
import { requireCase } from '@/server/access';
import { ApiError, route } from '@/server/http';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string; exportId: string }> };

/** Authenticated download (or in-page preview with ?inline=1) of an archived export. */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id, exportId } = await params;
  await requireCase(id);
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new ApiError(404, 'not_found', 'Not found');
  const file = await loadExport(id, exportId);
  if (!file) throw new ApiError(404, 'not_found', 'Not found');
  const inline = new URL(req.url).searchParams.get('inline') === '1' && file.mime === 'application/pdf';
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
