/**
 * Contract Agent: finds what the documents actually state about chargeable volume. It only quotes clauses that
 * exist in the evidence store; with no such clause the honest answer is `terms_missing`.
 */
import { createAgent } from '@mozaik-ai/core';
import { addInterpretation, addQuestion, buildEvidenceIndex, currentInterpretation, findEquivalentFact, insertFact, listDocuments, listFacts, type FactRow, type QuestionRow } from '@/db/repo';
import { decimalToString, tryParseDecimal } from '@/domain/calculations';
import { contentHash, forbiddenLanguage } from '@/domain/case-rules';
import { ContractOutput } from '@/domain/schemas';
import { emit } from '../events';
import { loopHandlers, reactTo } from '../handlers';
import { contractMessage, INSTRUCTIONS } from '../prompts';
import { state } from '../runtime';
import { runAgentTask } from '../tasks';
import { finish, requireKnownRefs, requireQuote } from './common';

const CONTRACT_DOC_KINDS = new Set(['quote', 'contract', 'messages', 'survey', 'other', 'invoice']);

export function createContractAgent() {
  return createAgent({
    name: 'Contract Agent',
    capabilities: ['inference'],
    instruction: INSTRUCTIONS.contract,
    tools: [],
    handlers: [
      ...loopHandlers(),
      reactTo('contract', ['case.started'], async (_e, p) => {
        const s = state();
        if (s.targeted.length && !s.targeted.includes('contract')) return;
        await runContract('Review all documents for chargeable-volume terms.', p.eventId);
      }),
      reactTo('contract', ['evidence.added'], async (_e, p) => {
        const kinds = (p.kinds as string[] | undefined) ?? [];
        if (kinds.length && !kinds.some((k) => CONTRACT_DOC_KINDS.has(k))) return;
        await runContract(`New evidence ${(p.documentRefs as string[]).join(', ')} may state or contradict contract terms.`, p.eventId);
      }),
      reactTo('contract', ['finding.challenged'], async (_e, p) => {
        await runContract(`The user challenged ${String(p.findingRef)}: ${String(p.reason).slice(0, 200)}`, p.eventId);
      }),
    ],
  });
}

async function runContract(reason: string, triggerEventId: string) {
  const s = state();
  await runAgentTask({
    role: 'contract',
    label: reason.slice(0, 80),
    triggerEventId,
    schema: ContractOutput,
    schemaName: 'contract_output',
    buildMessage: (fb) => contractMessage(s.caseId, reason, fb),
    async commit(out, { db, revision, runId, caseId }) {
      const index = await buildEvidenceIndex(caseId, db);
      const docs = new Map((await listDocuments(caseId, db)).map((d) => [d.ref, d]));
      const problems: string[] = [];
      if (out.termsStatus === 'terms_missing' && out.clauses.length) problems.push('termsStatus is terms_missing but clauses were listed; list only clauses that really appear.');
      if (out.termsStatus === 'terms_found' && !out.clauses.length) problems.push('termsStatus is terms_found but no clause was quoted.');
      out.clauses.forEach((c, i) => {
        const where = `clauses[${i}] (${c.kind})`;
        requireKnownRefs(c.spanRefs, index, where, problems);
        requireQuote(c.quote, c.spanRefs, index, where, problems);
        if (c.kind === 'minimum_chargeable_volume') {
          const n = tryParseDecimal(c.minimumCbm);
          if (!n || n.lte(0)) problems.push(`${where}: minimumCbm must be a positive number of CBM`);
        }
        if (c.kind === 'rounding' && c.roundUpToCbm && !tryParseDecimal(c.roundUpToCbm)) problems.push(`${where}: roundUpToCbm must be a number`);
      });
      out.challenges.forEach((c, i) => requireKnownRefs(c.spanRefs, index, `challenges[${i}]`, problems));
      if (forbiddenLanguage([out.summary, ...out.clauses.map((c) => c.interpretation)].join('\n')).length) problems.push('Avoid accusatory or entitlement language.');
      finish(problems);

      const clauseFacts: FactRow[] = [];
      const allClauseRefs: string[] = [];
      let affects = false;
      for (const c of out.clauses) {
        const sourceClass = docs.get(index.spans.get(c.spanRefs[0])!.documentRef)?.sourceClass ?? null;
        let key = 'other';
        let value = c.quote.slice(0, 300);
        let unit: string | null = null;
        let currency: string | null = null;
        if (c.kind === 'minimum_chargeable_volume') {
          key = 'minimum_chargeable_cbm';
          value = decimalToString(tryParseDecimal(c.minimumCbm)!);
          unit = 'CBM';
          affects = true;
        } else if (c.kind === 'rounding') key = 'rounding_rule';
        else if (c.kind === 'rate' && tryParseDecimal(c.rate)) {
          key = 'rate_per_cbm';
          value = decimalToString(tryParseDecimal(c.rate)!);
          currency = c.currency?.toUpperCase() ?? null;
          if (!currency) {
            key = 'other';
            value = c.quote.slice(0, 300);
          }
        }
        const existing = await findEquivalentFact(db, caseId, { key, subject: c.kind, value, spanRefs: c.spanRefs });
        if (existing) {
          allClauseRefs.push(existing.ref);
          continue;
        }
        const fact = await insertFact(db, caseId, {
          key,
          subject: c.kind,
          value,
          unit,
          currency,
          spanRefs: c.spanRefs,
          quote: c.quote,
          provenance: 'extracted',
          sourceClass,
          confidence: 'high',
          notes: c.interpretation,
          producedBy: 'contract',
          runId,
          evidenceRevision: revision,
        });
        clauseFacts.push(fact);
        allClauseRefs.push(fact.ref);
      }
      const prev = await currentInterpretation(caseId, db);
      const sameAsPrev = prev && prev.termsStatus === out.termsStatus && contentHash(prev.clauseFactRefs.slice().sort()) === contentHash(allClauseRefs.slice().sort()) && prev.affectsCalculation === affects;
      const interp = sameAsPrev
        ? prev!
        : await addInterpretation(db, caseId, { termsStatus: out.termsStatus, summary: out.summary, clauseFactRefs: allClauseRefs, challenges: out.challenges, affectsCalculation: affects }, { producedBy: 'contract', runId, evidenceRevision: revision });
      const questions: QuestionRow[] = [];
      for (const q of out.carrierQuestions) {
        const r = await addQuestion(db, caseId, { ...q, audience: 'carrier' }, { raisedBy: 'contract', runId, evidenceRevision: revision });
        if (r.inserted) questions.push(r.question);
      }
      return {
        result: { interp, changed: !sameAsPrev, clauseFacts, affects, questions },
        summary: out.termsStatus === 'terms_missing' ? 'No document states how chargeable volume is determined (terms missing).' : `Found ${out.clauses.length} contract term${out.clauses.length === 1 ? '' : 's'}: ${out.summary}`.slice(0, 300),
      };
    },
    async after({ interp, changed, clauseFacts, affects, questions }) {
      const s2 = state();
      s2.facts = new Map((await listFacts(s2.caseId)).map((f) => [f.ref, f]));
      if (clauseFacts.length) {
        await emit('fact.recorded', { factRefs: clauseFacts.map((f) => f.ref), keys: [...new Set(clauseFacts.map((f) => f.key))], by: 'contract' }, { producer: 'contract', causationId: triggerEventId });
      }
      if (questions.length) await emit('question.raised', { questionRefs: questions.map((q) => q.ref), by: 'contract' }, { producer: 'contract', causationId: triggerEventId });
      if (changed) {
        await emit('contract.interpretation', { termsStatus: interp.termsStatus, affectsCalculation: affects, clauseFactRefs: interp.clauseFactRefs, interpretationRef: interp.ref }, { producer: 'contract', causationId: triggerEventId });
      }
    },
  });
}
