/**
 * Situation handlers: the "when" (SituationSpecification on event type) and "then" (processor) pairs that make
 * agents react to each other's events instead of being scripted. Each role's work is serialised through a queue,
 * so one agent never runs two loops at once, while different agents' loops overlap freely.
 */
import { Agent, SituationSpecification, type Participant, type SemanticEvent, type SituationContext, type SituationHandler } from '@mozaik-ai/core';
import type { AgentRole } from '@/domain/schemas';
import type { BusPayload } from './events';
import { onLoopStarted, onModelAnswer } from './tasks';
import { state } from './runtime';

export class WhenEvent extends SituationSpecification {
  constructor(
    private readonly types: readonly string[],
    private readonly filter?: (event: SemanticEvent, participant: Participant) => boolean,
  ) {
    super();
  }
  isSatisfiedBy({ event, participant }: SituationContext): boolean {
    // Agents ignore events they produced themselves (no self-feedback unless a feedback path is explicit).
    if (event.producerId === participant.getId()) return false;
    if (!this.types.includes(event.type)) return false;
    return this.filter ? this.filter(event, participant) : true;
  }
}

const queues = new Map<string, Promise<unknown>>();
let counter = 0;

/** Run `fn` after the role's previous task; keep the run "busy" while it waits. */
export function enqueue(role: AgentRole | 'coordinator', fn: () => Promise<void>): Promise<void> {
  const s = state();
  const key = `queued:${role}:${++counter}`;
  s.inFlight.add(key);
  const prev = queues.get(role) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      if (s.cancelled) return;
      await fn();
    })
    .catch((err) => console.error(`[${role}] task error:`, (err as Error).message))
    .finally(() => s.inFlight.delete(key));
  queues.set(role, next);
  return next;
}

export function reactTo(
  role: AgentRole,
  types: readonly string[],
  run: (event: SemanticEvent, payload: BusPayload) => Promise<void> | void,
  filter?: (event: SemanticEvent, participant: Participant) => boolean,
): SituationHandler {
  return {
    specification: new WhenEvent(types, filter),
    processor: {
      apply({ event }) {
        const s = state();
        const payload = event.payload as BusPayload;
        if (s.cancelled) return;
        if (s.hasProcessed(role, payload.eventId)) {
          s.duplicateEventsDropped++;
          return;
        }
        s.markProcessed(role, payload.eventId);
        void enqueue(role, async () => {
          await run(event, payload);
        });
      },
    },
  };
}

/** Links an agent's Mozaik loop events (loopId, final answer) back to the task that started the loop. */
export function loopHandlers(): SituationHandler[] {
  class Own extends SituationSpecification {
    constructor(private readonly type: string) {
      super();
    }
    isSatisfiedBy({ event, participant }: SituationContext): boolean {
      return event.type === this.type && event.producerId === participant.getId();
    }
  }
  return [
    {
      specification: new Own('message_received.started'),
      processor: {
        apply({ event }) {
          const p = event.payload as { loopId: string; input: { context: { id: string } } };
          onLoopStarted(p.input.context.id, p.loopId);
        },
      },
    },
    {
      specification: new Own('model.answer'),
      processor: {
        apply({ event }) {
          const p = event.payload as { loopId: string; answer: { content: { text: string } } };
          onModelAnswer(p.loopId, p.answer.content.text);
        },
      },
    },
  ];
}

export function roleOf(participant: Participant): AgentRole | null {
  for (const [role, id] of state().participantIds) if (id === participant.getId()) return role as AgentRole;
  return null;
}
export { Agent };
