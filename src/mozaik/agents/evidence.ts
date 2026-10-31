/**
 * Evidence Agent: turns document text into cited facts. Output is validated (schema, span identifiers, verbatim
 * quotes, numeric sanity) before any fact is stored.
 */
import { createAgent } from '@mozaik-ai/core';
import { addQuestion, buildEvidenceIndex, findEquivalentFact, insertFact, listDocuments, listFacts, type FactRow, type QuestionRow } from '@/db/repo';
import { decimalToString, parseDecimal, toCbm, tryParseDecimal } from '@/domain/calculations';
import { parseDimensions } from '@/domain/case-rules';
import { EvidenceOutput } from '@/domain/schemas';
import { emit } from '../events';
import { loopHandlers, reactTo } from '../handlers';
import { evidenceMessage, INSTRUCTIONS } from '../prompts';
import { state } from '../runtime';
import { runAgentTask } from '../tasks';
import { finish, requireKnownRefs, requireQuote } from './common';

export function createEvidenceAgent() {
  return createAgent({
    name: 'Evidence Agent',
    capabilities: ['inference'],
    instruction: INSTRUCTIONS.evidence,
    tools: [],
    handlers: [
      ...loopHandlers(),
      reactTo('evidence', ['case.started'], async (_e, p) => {
        const s = state();
        if (s.targeted.length && !s.targeted.includes('evidence')) return;
        await runEvidence([], p.eventId, 'Read all documents');
      }),
      reactTo('evidence', ['evidence.added'], async (_e, p) => {
        await runEvidence(p.documentRefs as string[], p.eventId, `Read new evidence ${(p.documentRefs as string[]).join(', ')}`);
      }),
    ],
  });
}

function currencyFromQuote(quote: string): string | null {
  if (/₦|\bNGN\b|\bNaira\b/i.test(quote)) return 'NGN';
  if (/\bUSD\b|\$/.test(quote)) return 'USD';
  if (/\bEUR\b|€/.test(quote)) return 'EUR';
  if (/\bGBP\b|£/.test(quote)) return 'GBP';
  return null;
}

async function runEvidence(documentRefs: string[], triggerEventId: string, label: string) {
  const s = state();
  const only = documentRefs.length ? documentRefs : null;
  await runAgentTask({
    role: 'evidence',
    label,
    triggerEventId,
    schema: EvidenceOutput,
    schemaName: 'evidence_output',
    buildMessage: (fb) => evidenceMessage(s.caseId, only, fb),
    async commit(out, { db, revision, runId, caseId }) {
      const index = await buildEvidenceIndex(caseId, db);
      const docs = new Map((await listDocuments(caseId, db)).map((d) => [d.ref, d]));
      const problems: string[] = [];
      const clean: (EvidenceOutput['facts'][number] & { value: string; unit: string | null; currency: string | null })[] = [];

      out.facts.forEach((f, i) => {
        const where = `facts[${i}] (${f.key})`;
        requireKnownRefs(f.spanRefs, index, where, problems);
        requireQuote(f.quote, f.spanRefs, index, where, problems);
        let value = f.value.trim();
        let unit = f.unit?.trim() || null;
        let currency = f.currency?.trim().toUpperCase() || null;
        try {
          if (/_cbm$/.test(f.key)) {
            unit = unit && /^(cbm|m3|m³|cm3|cm³)$/i.test(unit) ? unit : 'CBM';
            value = decimalToString(toCbm(parseDecimal(value), unit));
            unit = 'CBM';
          } else if (f.key === 'rate_per_cbm' || /_amount$/.test(f.key)) {
            value = decimalToString(parseDecimal(value));
            currency = currency ?? currencyFromQuote(f.quote);
            if (!currency) problems.push(`${where}: money values need a 3-letter currency`);
          } else if (f.key === 'package_count') {
            const n = tryParseDecimal(value);
            if (!n || !n.isInteger() || n.lte(0)) problems.push(`${where}: package_count must be a positive whole number`);
            else value = decimalToString(n);
          } else if (f.key === 'package_dimensions_cm') {
            const d = parseDimensions(value);
            if (!d) problems.push(`${where}: package_dimensions_cm must look like "120x34x22"`);
            else value = `${d.l}x${d.w}x${d.h}`;
            unit = 'cm';
          }
        } catch (e) {
          problems.push(`${where}: ${(e as Error).message}`);
        }
        clean.push({ ...f, value, unit, currency });
      });
      out.ambiguities.forEach((a, i) => requireKnownRefs(a.spanRefs, index, `ambiguities[${i}]`, problems));
      finish(problems);

      const created: FactRow[] = [];
      for (const f of clean) {
        const docRef = index.spans.get(f.spanRefs[0])!.documentRef;
        const doc = docs.get(docRef);
        if (await findEquivalentFact(db, caseId, { key: f.key, subject: f.subject, value: f.value, spanRefs: f.spanRefs })) continue;
        created.push(
          await insertFact(db, caseId, {
            key: f.key,
            subject: f.subject,
            value: f.value,
            unit: f.unit,
            currency: f.currency,
            spanRefs: f.spanRefs,
            quote: f.quote,
            provenance: doc?.sourceClass === 'user_statement' ? 'user_statement' : 'extracted',
            sourceClass: doc?.sourceClass ?? null,
            confidence: f.confidence,
            notes: f.notes,
            producedBy: 'evidence',
            runId,
            evidenceRevision: revision,
          }),
        );
      }
      const questions: QuestionRow[] = [];
      for (const q of out.questions) {
        const r = await addQuestion(db, caseId, q, { raisedBy: 'evidence', runId, evidenceRevision: revision });
        if (r.inserted) questions.push(r.question);
      }
      for (const a of out.ambiguities) {
        const r = await addQuestion(db, caseId, { audience: 'user', prompt: `Please clarify: ${a.description}`, reason: 'The documents are ambiguous on this point.' }, { raisedBy: 'evidence', runId, evidenceRevision: revision });
        if (r.inserted) questions.push(r.question);
      }
      return {
        result: { created, questions },
        summary: created.length
          ? `Recorded ${created.length} cited fact${created.length === 1 ? '' : 's'}${questions.length ? ` and raised ${questions.length} question${questions.length === 1 ? '' : 's'}` : ''}.`
          : 'No new facts beyond those already recorded.',
      };
    },
    async after({ created, questions }) {
      const s2 = state();
      s2.facts = new Map((await listFacts(s2.caseId)).map((f) => [f.ref, f]));
      if (created.length) {
        await emit('fact.recorded', { factRefs: created.map((f) => f.ref), keys: [...new Set(created.map((f) => f.key))], by: 'evidence' }, { producer: 'evidence', causationId: triggerEventId });
      }
      if (questions.length) await emit('question.raised', { questionRefs: questions.map((q) => q.ref), by: 'evidence' }, { producer: 'evidence', causationId: triggerEventId });
    },
  });
}
