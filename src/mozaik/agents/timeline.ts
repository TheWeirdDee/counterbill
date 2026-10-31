/**
 * Timeline Agent: reconstructs a cited sequence of events. It never fills in unknown dates or infers order
 * from upload order; conflicts are stored as competing cards.
 */
import { createAgent } from '@mozaik-ai/core';
import { addTimelineEvent, buildEvidenceIndex } from '@/db/repo';
import { TimelineOutput } from '@/domain/schemas';
import { emit } from '../events';
import { loopHandlers, reactTo } from '../handlers';
import { INSTRUCTIONS, timelineMessage } from '../prompts';
import { state } from '../runtime';
import { runAgentTask } from '../tasks';
import { finish, requireKnownRefs } from './common';

const DATE_KEYS = /^(invoice_date|survey_date|payment_status)$/;

export function createTimelineAgent() {
  return createAgent({
    name: 'Timeline Agent',
    capabilities: ['inference'],
    instruction: INSTRUCTIONS.timeline,
    tools: [],
    handlers: [
      ...loopHandlers(),
      reactTo('timeline', ['case.started'], async (_e, p) => {
        const s = state();
        if (s.targeted.length && !s.targeted.includes('timeline')) return;
        await runTimeline('Reconstruct the sequence from all documents.', p.eventId);
      }),
      // Targeted: only wakes when newly recorded facts carry dates or payment information.
      reactTo(
        'timeline',
        ['fact.recorded'],
        async (_e, p) => {
          await runTimeline(`New dated facts were recorded (${(p.keys as string[]).join(', ')}).`, p.eventId);
        },
        (e) => ((e.payload as { keys?: string[] }).keys ?? []).some((k) => DATE_KEYS.test(k)),
      ),
    ],
  });
}

async function runTimeline(reason: string, triggerEventId: string) {
  const s = state();
  await runAgentTask({
    role: 'timeline',
    label: reason.slice(0, 80),
    triggerEventId,
    schema: TimelineOutput,
    schemaName: 'timeline_output',
    buildMessage: (fb) => timelineMessage(s.caseId, reason, fb),
    async commit(out, { db, revision, runId, caseId }) {
      const index = await buildEvidenceIndex(caseId, db);
      const problems: string[] = [];
      out.events.forEach((e, i) => requireKnownRefs(e.spanRefs, index, `events[${i}]`, problems));
      out.conflicts.forEach((c, i) => requireKnownRefs(c.spanRefs, index, `conflicts[${i}]`, problems));
      finish(problems);
      const meta = { runId, evidenceRevision: revision };
      const refs: string[] = [];
      for (const e of out.events) {
        const r = await addTimelineEvent(db, caseId, { occurredOn: e.date, datePrecision: e.date ? e.datePrecision : 'unknown', actor: e.actor, description: e.description, spanRefs: e.spanRefs }, meta);
        if (r.inserted) refs.push(r.row.ref);
      }
      for (const c of out.conflicts) {
        const r = await addTimelineEvent(db, caseId, { occurredOn: null, datePrecision: 'unknown', actor: null, description: c.description, spanRefs: c.spanRefs, kind: 'conflict' }, meta);
        if (r.inserted) refs.push(r.row.ref);
      }
      for (const g of out.gaps) {
        const r = await addTimelineEvent(db, caseId, { occurredOn: null, datePrecision: 'unknown', actor: null, description: g, spanRefs: [], kind: 'gap' }, meta);
        if (r.inserted) refs.push(r.row.ref);
      }
      return { result: refs, summary: refs.length ? `Added ${refs.length} timeline entr${refs.length === 1 ? 'y' : 'ies'}.` : 'No new timeline entries.' };
    },
    async after(refs) {
      if (refs.length) await emit('timeline.updated', { eventRefs: refs }, { producer: 'timeline', causationId: triggerEventId });
    },
  });
}
