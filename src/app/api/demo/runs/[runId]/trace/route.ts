import { getRun } from '@/db/repo';
import { ApiError, route } from '@/server/http';
import { GET as caseTrace } from '../../../../cases/[id]/trace/route';

export const dynamic = 'force-dynamic';

/** PRD alias: downloadable sanitised trace JSON for a sample run (no prompts, document text or secrets). */
export const GET = route(async (req: Request, { params }: { params: Promise<{ runId: string }> }) => {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new ApiError(404, 'not_found', 'Not found');
  const run = await getRun(runId);
  if (!run) throw new ApiError(404, 'not_found', 'Not found');
  return caseTrace(req, { params: Promise.resolve({ id: run.caseId }) });
});
