/**
 * Trace observer: a Mozaik participant that subscribes to the runtime's own loop events and persists a sanitised
 * record of them. What is stored is what the runtime actually emitted (agent, loopId, timestamps, token counts,
 * tool names). Prompts, document text and model answers are never stored here.
 */
import { SituationSpecification, createHuman, type SituationContext } from '@mozaik-ai/core';
import { appendEvent } from '@/db/repo';
import { state } from './runtime';

const MAP: Record<string, string> = {
  'message_received.started': 'mozaik.loop.started',
  'inference.started': 'mozaik.inference.started',
  'inference.completed': 'mozaik.inference.completed',
  'function_call.started': 'mozaik.function_call.started',
  'function_call.completed': 'mozaik.function_call.completed',
  'model.answer': 'mozaik.model.answer',
};

class WhenLoopEvent extends SituationSpecification {
  isSatisfiedBy({ event }: SituationContext): boolean {
    return event.type in MAP;
  }
}

const counters = new Map<string, number>();

function sanitise(type: string, payload: Record<string, unknown>): Record<string, unknown> {
  const loopId = payload.loopId as string;
  switch (type) {
    case 'message_received.started': {
      const input = payload.input as { model?: string; structuredOutput?: { name?: string }; tools?: unknown[] } | undefined;
      return { loopId, model: input?.model, structuredOutput: input?.structuredOutput?.name, tools: input?.tools?.length ?? 0 };
    }
    case 'inference.started': {
      const input = payload as unknown as { model?: string; context?: { items?: unknown[] } };
      return { loopId, model: input.model, contextItems: input.context?.items?.length };
    }
    case 'inference.completed': {
      const out = payload as unknown as { items?: { type: string }[]; tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number } };
      return { loopId, itemTypes: out.items?.map((i) => i.type), tokens: out.tokenUsage ? { input: out.tokenUsage.inputTokens, output: out.tokenUsage.outputTokens, total: out.tokenUsage.totalTokens } : null };
    }
    case 'function_call.started': {
      const call = (payload as unknown as { call?: { name?: string } }).call;
      return { loopId, tool: call?.name };
    }
    case 'function_call.completed':
      return { loopId };
    case 'model.answer': {
      const ans = (payload as unknown as { answer?: { content?: { text?: string } } }).answer;
      return { loopId, answerChars: ans?.content?.text?.length ?? 0 };
    }
    default:
      return { loopId };
  }
}

export function createTraceObserver() {
  return createHuman({
    name: 'Trace Observer',
    capabilities: [],
    handlers: [
      {
        specification: new WhenLoopEvent(),
        processor: {
          apply({ event }) {
            const s = state();
            let role: string | null = null;
            for (const [r, id] of s.participantIds) if (id === event.producerId) role = r;
            if (!role || role === 'system' || role === 'trace') return;
            const payload = event.payload as Record<string, unknown>;
            const loopId = payload.loopId as string;
            const type = MAP[event.type];
            const k = `${loopId}:${type}`;
            const n = (counters.get(k) ?? 0) + 1;
            counters.set(k, n);
            void appendEvent({
              caseId: s.caseId,
              runId: s.runId,
              type,
              producer: role,
              payload: { ...sanitise(event.type, payload), mozaikAt: event.occurredAt.toISOString() },
              correlationId: s.runId,
              evidenceRevision: s.evidenceRevision,
              idempotencyKey: `${s.runId}:mozaik:${k}:${n}`,
            }).catch((e) => console.error('[trace] persist failed', (e as Error).message));
          },
        },
      },
    ],
  });
}
