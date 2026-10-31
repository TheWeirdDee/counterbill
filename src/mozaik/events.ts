/**
 * Application events. Every event is persisted to `case_events` (append-only, idempotent) BEFORE it is
 * published on the Mozaik runtime, so the UI stream, the trace and agent reactions all derive from the same record.
 */
import { SemanticEvent } from '@mozaik-ai/core';
import { appendEvent, type EventRow } from '@/db/repo';
import { contentHash } from '@/domain/case-rules';
import { EVENT_PAYLOAD, type EventType } from '@/domain/schemas';
import { resolveRuntime, sendEvent, state } from './runtime';

export type Producer = 'system' | 'human' | 'evidence' | 'billing' | 'contract' | 'timeline' | 'case' | 'drafting' | 'trace';

export interface EmitOptions {
  producer: Producer;
  causationId?: string | null;
  /** Override the derived idempotency key (e.g. when an event is naturally unique). */
  key?: string;
}

/** Persist then publish. Returns null when the event was a duplicate and was therefore dropped. */
export async function emit(type: EventType, payload: Record<string, unknown>, opts: EmitOptions): Promise<EventRow | null> {
  const s = state();
  const schema = EVENT_PAYLOAD[type];
  if (schema) schema.parse(payload);
  const key = opts.key ?? `${s.runId}:${type}:${opts.producer}:${opts.causationId ?? ''}:${contentHash(payload)}`;
  const { event, inserted } = await appendEvent({
    caseId: s.caseId,
    runId: s.runId,
    type,
    producer: opts.producer,
    payload,
    causationId: opts.causationId ?? null,
    correlationId: s.runId,
    evidenceRevision: s.evidenceRevision,
    idempotencyKey: key,
  });
  if (!inserted) {
    s.duplicateEventsDropped++;
    return null;
  }
  const senderId = s.participantIds.get(opts.producer) ?? s.participantIds.get('system')!;
  // Only reach the runtime if it still has the sender (it always does inside a run).
  if (resolveRuntime().getParticipant(senderId)) {
    sendEvent(SemanticEvent.create(type, senderId, { eventId: event.id, seq: event.seq, evidenceRevision: s.evidenceRevision, ...payload }), senderId);
  }
  return event;
}

/** Payload shape every application event carries on the Mozaik bus. */
export interface BusPayload {
  eventId: string;
  seq: string;
  evidenceRevision: number;
  [k: string]: unknown;
}
