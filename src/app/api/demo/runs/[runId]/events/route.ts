import { getRun } from '@/db/repo';
import { ApiError, route } from '@/server/http';
import { GET as caseEvents } from '../../../../cases/[id]/events/route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** PRD alias: sanitised SSE for a sample run. Access is still checked per case (the visitor's own browser only). */
export const GET = route(async (req: Request, { params }: { params: Promise<{ runId: string }> }) => {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new ApiError(404, 'not_found', 'Not found');
  const run = await getRun(runId);
  if (!run) throw new ApiError(404, 'not_found', 'Not found');
  return caseEvents(req, { params: Promise.resolve({ id: run.caseId }) });
});
