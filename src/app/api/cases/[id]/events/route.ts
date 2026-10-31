import { listEvents } from '@/db/repo';
import { requireCase } from '@/server/access';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string }> };

/**
 * Server-sent events from the durable event log. Each message's `id` is the monotonic event sequence, so a
 * reconnecting client (Last-Event-ID or ?after=) is replayed everything it missed, in order, then follows live.
 * The stream is derived from the same persisted events that agents react to; nothing is timer-driven.
 */
export const GET = route(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  await requireCase(id);
  const url = new URL(req.url);
  let cursor = Number(req.headers.get('last-event-id') ?? url.searchParams.get('after') ?? 0) || 0;
  const encoder = new TextEncoder();
  const deadline = Date.now() + 4 * 60_000; // clients reconnect transparently; keeps connections bounded

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      send('retry: 1500\n\n');
      let lastBeat = Date.now();
      try {
        while (!req.signal.aborted && Date.now() < deadline) {
          const events = await listEvents(id, cursor, 200);
          for (const e of events) {
            cursor = Number(e.seq);
            send(`id: ${e.seq}\nevent: case_event\ndata: ${JSON.stringify({ seq: Number(e.seq), id: e.id, caseId: e.caseId, runId: e.runId, agentId: e.producer, type: e.type, timestamp: e.occurredAt, evidenceRevision: e.evidenceRevision, causationId: e.causationId, payload: e.payload })}\n\n`);
            lastBeat = Date.now();
          }
          if (Date.now() - lastBeat > 15_000) {
            send(': keep-alive\n\n');
            lastBeat = Date.now();
          }
          await new Promise((r) => setTimeout(r, events.length ? 100 : 500));
        }
      } catch {
        /* client went away or db hiccup: the client will reconnect with its cursor */
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
});
