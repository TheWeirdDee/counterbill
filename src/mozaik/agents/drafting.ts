/**
 * Drafting Agent: writes the four body sections of the letter from the current assessment. Everything else in the
 * letter is deterministic. User-edited sections are never overwritten: agent changes to them become a proposal
 * the user accepts or declines.
 */
import { createAgent } from '@mozaik-ai/core';
import type { PoolClient } from 'pg';
import { one, query } from '@/db/pool';
import {
  buildEvidenceIndex,
  currentDraft,
  getCase,
  insertDraft,
  latestAssessment,
  listCalculations,
  listDocuments,
  listFacts,
  listFindings,
  type DraftRow,
} from '@/db/repo';
import { allowedFigures, contentHash, forbiddenLanguage, unsupportedFigures, type FactLite } from '@/domain/case-rules';
import { refKind } from '@/domain/citations';
import { buildAnnex, deterministicSections, letterPlainText, mergeAgentDraft, sectionsFingerprint, toSections, type LetterSectionData } from '@/domain/letter';
import { DraftOutput, LETTER_SECTION_TITLE, DRAFT_BODY_SECTIONS } from '@/domain/schemas';
import { emit } from '../events';
import { loopHandlers, reactTo } from '../handlers';
import { draftingMessage, INSTRUCTIONS } from '../prompts';
import { state } from '../runtime';
import { runAgentTask } from '../tasks';
import { finish, requireKnownRefs } from './common';

export function createDraftingAgent() {
  return createAgent({
    name: 'Drafting Agent',
    capabilities: ['inference'],
    instruction: INSTRUCTIONS.drafting,
    tools: [],
    handlers: [
      ...loopHandlers(),
      reactTo('drafting', ['assessment.updated'], async (_e, p) => {
        const existing = await currentDraft(state().caseId);
        if (existing && p.changed === false) return; // a no-op reassessment does not rewrite the letter
        await runDrafting(p.eventId, Number(p.version));
      }),
    ],
  });
}

const lite = (f: { ref: string; key: string; subject: string | null; value: string; unit: string | null; currency: string | null; status: string }): FactLite => ({
  ref: f.ref, key: f.key, subject: f.subject, value: f.value, unit: f.unit, currency: f.currency, status: f.status,
});

async function runDrafting(triggerEventId: string, assessmentVersion: number) {
  const s = state();
  const sig = contentHash({ v: assessmentVersion, f: (await listFindings(s.caseId)).map((f) => [f.ref, f.status]) });
  if (s.inputSignature.get('drafting') === sig) return;
  await runAgentTask({
    role: 'drafting',
    label: `Draft letter from assessment v${assessmentVersion}`,
    triggerEventId,
    schema: DraftOutput,
    schemaName: 'draft_output',
    async buildMessage(fb) {
      const cur = await currentDraft(s.caseId);
      return draftingMessage(s.caseId, cur ? letterPlainText(cur.sections as LetterSectionData[]) : null, fb);
    },
    async commit(out, { db, revision, runId, caseId }) {
      const index = await buildEvidenceIndex(caseId, db);
      const facts = await listFacts(caseId, {}, db);
      const calcs = await listCalculations(caseId, {}, db);
      const problems: string[] = [];
      const ids = out.sections.map((x) => x.id);
      for (const id of DRAFT_BODY_SECTIONS) if (!ids.includes(id)) problems.push(`Missing section "${id}".`);
      if (new Set(ids).size !== ids.length) problems.push('Each section may appear once.');
      out.sections.forEach((sec) => {
        requireKnownRefs(sec.refs, index, `section ${sec.id}`, problems);
        const bad = unsupportedFigures(sec.text, allowedFigures(facts.map(lite), calcs));
        if (bad.length) problems.push(`section ${sec.id} states figures that are not in the calculations or facts: ${bad.join(', ')}.`);
        if (forbiddenLanguage(sec.text).length) problems.push(`section ${sec.id} uses accusatory, entitlement or threatening language.`);
      });
      finish(problems);

      const c = (await getCase(caseId, db))!;
      const profile = c.ownerId ? await one<{ display_name: string; organization_name: string; contact_details: string }>('select display_name, organization_name, contact_details from users where id = $1', [c.ownerId], db) : null;
      const docs = await listDocuments(caseId, db);
      const factsByRef = new Map(facts.map((f) => [f.ref, f]));
      const calcsByRef = new Map(calcs.map((k) => [k.ref, k]));
      const findingsByRef = new Map((await listFindings(caseId, { includeSuperseded: true }, db)).map((f) => [f.ref, f]));

      const docRefs = new Set<string>();
      const addSpans = (spans: string[]) => spans.forEach((sp) => docRefs.add(index.spans.get(sp)?.documentRef ?? ''));
      for (const sec of out.sections)
        for (const r of sec.refs) {
          const k = refKind(r);
          if (k === 'span') addSpans([r]);
          if (k === 'document') docRefs.add(r);
          if (k === 'fact') addSpans(factsByRef.get(r)?.spanRefs ?? []);
          if (k === 'calculation') for (const fr of calcsByRef.get(r)?.inputFactRefs ?? []) addSpans(factsByRef.get(fr)?.spanRefs ?? []);
          if (k === 'finding') {
            const f = findingsByRef.get(r);
            addSpans(f?.spanRefs ?? []);
            for (const fr of f?.factRefs ?? []) addSpans(factsByRef.get(fr)?.spanRefs ?? []);
          }
        }
      docRefs.delete('');
      const annexDocs = docs.filter((d) => docRefs.has(d.ref) && d.sourceClass !== 'user_statement');
      const annex = buildAnnex(annexDocs);
      const shipmentRef = facts.find((f) => f.key === 'shipment_reference')?.value ?? null;
      const det = deterministicSections({
        claimant: c.claimant,
        senderName: profile?.display_name ?? '',
        senderContact: [profile?.organization_name, profile?.contact_details].filter(Boolean).join('\n'),
        counterparty: c.counterparty,
        shipmentReference: shipmentRef,
        annex,
        today: new Date(),
        isDemo: c.isDemo,
      });
      const parts: Record<string, { text: string; refs: string[] }> = { ...det };
      for (const sec of out.sections) parts[sec.id] = { text: sec.text, refs: sec.refs };
      const fresh: LetterSectionData[] = toSections(parts);
      for (const sec of fresh) sec.title = LETTER_SECTION_TITLE[sec.id as keyof typeof LETTER_SECTION_TITLE];

      const current = await currentDraft(caseId, db);
      const { merged, conflicts, changedSectionIds } = mergeAgentDraft(current ? (current.sections as LetterSectionData[]) : null, fresh);
      const unchanged = current && sectionsFingerprint(merged) === sectionsFingerprint(current.sections as LetterSectionData[]) && conflicts.length === 0;
      let draft: DraftRow | null = null;
      let proposal: DraftRow | null = null;
      if (!unchanged) {
        await supersedeCurrent(db, caseId);
        draft = await insertDraft(db, caseId, { status: 'current', sections: merged, evidenceRevision: revision, baseVersion: current?.version ?? null, createdBy: 'agent', changeSummary: out.changeSummary, runId });
        if (conflicts.length) {
          await query("update letter_drafts set status = 'rejected' where case_id = $1 and status = 'proposed'", [caseId], db);
          proposal = await insertDraft(db, caseId, { status: 'proposed', sections: conflicts, evidenceRevision: revision, baseVersion: draft.version, createdBy: 'agent', changeSummary: out.changeSummary, runId });
        }
      }
      return {
        result: { draft, proposal, changedSectionIds, unchanged: !!unchanged },
        summary: unchanged ? 'The letter is already consistent with the assessment.' : proposal ? `Updated the letter (v${draft!.version}) and proposed changes to ${conflicts.length} section(s) you edited.` : `${current ? 'Revised' : 'Wrote'} the letter (v${draft!.version}).`,
      };
    },
    async after({ draft, proposal }) {
      s.inputSignature.set('drafting', sig);
      if (draft) {
        s.draftVersion = draft.version;
        await emit('draft.updated', { version: draft.version, proposed: !!proposal }, { producer: 'drafting', causationId: triggerEventId });
      }
    },
  });
}

async function supersedeCurrent(db: PoolClient, caseId: string) {
  await query("update letter_drafts set status = 'superseded' where case_id = $1 and status = 'current'", [caseId], db);
}
