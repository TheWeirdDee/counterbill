/**
 * User-initiated changes. Each one records provenance, bumps the evidence revision only when evidence really
 * changed, and asks for a targeted reassessment instead of restarting the whole investigation.
 */
import { one, query, tx } from '@/db/pool';
import {
  appendEvent,
  bumpRevision,
  currentDraft,
  deleteCaseCompletely,
  getCase,
  getDocument,
  insertDraft,
  insertFact,
  listDocuments,
  pendingProposal,
  type DraftRow,
  type FactRow,
  type LetterSection,
} from '@/db/repo';
import { decimalToString, parseDecimal, toCbm, tryParseDecimal } from '@/domain/calculations';
import { parseDimensions } from '@/domain/case-rules';
import type { LetterSectionData } from '@/domain/letter';
import { FACT_KEYS } from '@/domain/schemas';
import { addDocument, parseQueuedDocument } from './documents';
import { ApiError } from './http';
import { requestReassess } from './runs';

function normalizeFactValue(key: string, value: string, unit: string | null, currency: string | null): { value: string; unit: string | null } {
  try {
    if (key !== 'rate_per_cbm' && /_cbm$/.test(key)) return { value: decimalToString(toCbm(parseDecimal(value), unit && /^(cbm|m3|m³|cm3|cm³)$/i.test(unit) ? unit : 'CBM')), unit: 'CBM' };
    if (key === 'rate_per_cbm' || /_amount$/.test(key)) {
      if (!currency) throw new Error('Money values need a currency.');
      return { value: decimalToString(parseDecimal(value)), unit: key === 'rate_per_cbm' ? 'per CBM' : unit };
    }
    if (key === 'package_count') {
      const n = tryParseDecimal(value);
      if (!n || !n.isInteger() || n.lte(0)) throw new Error('Enter a whole number.');
      return { value: decimalToString(n), unit };
    }
    if (key === 'package_dimensions_cm') {
      const d = parseDimensions(value);
      if (!d) throw new Error('Use the form 120x34x22 (centimetres).');
      return { value: `${d.l}x${d.w}x${d.h}`, unit: 'cm' };
    }
  } catch (e) {
    throw new ApiError(422, 'invalid_fact_value', (e as Error).message);
  }
  return { value, unit };
}

/** A user correction creates a NEW fact (provenance user_correction); the original extraction is kept, superseded. */
export async function correctFact(caseId: string, factRef: string, input: { value: string; unit?: string | null; note: string; expectedRevision?: number }): Promise<{ fact: FactRow; reassessQueued: boolean }> {
  const out = await tx(async (db) => {
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const c = (await getCase(caseId, db))!;
    if (input.expectedRevision !== undefined && input.expectedRevision !== c.revision) {
      throw new ApiError(409, 'revision_conflict', 'The case changed while you were editing. Refresh and try again.', true);
    }
    const old = await one<{ key: string; subject: string | null; unit: string | null; currency: string | null; span_refs: string[]; quote: string | null; status: string }>(
      'select key, subject, unit, currency, span_refs, quote, status from facts where case_id = $1 and ref = $2',
      [caseId, factRef],
      db,
    );
    if (!old) throw new ApiError(404, 'not_found', 'Fact not found');
    if (old.status !== 'active') throw new ApiError(409, 'fact_superseded', 'That fact has already been corrected.');
    const norm = normalizeFactValue(old.key, input.value, input.unit ?? old.unit, old.currency);
    const revision = await bumpRevision(db, caseId);
    const fact = await insertFact(db, caseId, {
      key: old.key,
      subject: old.subject,
      value: norm.value,
      unit: norm.unit,
      currency: old.currency,
      spanRefs: old.span_refs,
      quote: old.quote,
      provenance: 'user_correction',
      sourceClass: 'user_statement',
      confidence: 'high',
      correctsRef: factRef,
      correctionNote: input.note || null,
      producedBy: 'human',
      evidenceRevision: revision,
    });
    await query("update facts set status = 'superseded' where case_id = $1 and ref = $2", [caseId, factRef], db);
    return { fact, revision };
  });
  const run = await requestReassess(caseId, { reason: `You corrected ${factRef}`, event: { type: 'fact.corrected', payload: { factRef: out.fact.ref, replacesRef: factRef, key: out.fact.key } } });
  if (!run) {
    await appendEvent({ caseId, type: 'fact.corrected', producer: 'human', payload: { factRef: out.fact.ref, replacesRef: factRef, key: out.fact.key }, evidenceRevision: out.revision, idempotencyKey: `fact.corrected:${caseId}:${out.fact.ref}` });
  }
  return { fact: out.fact, reassessQueued: !!run };
}

/** Add a fact by hand (the fallback when a document could not be read). Marked as a user statement. */
export async function addManualFact(caseId: string, input: { key: string; value: string; unit?: string | null; currency?: string | null; subject?: string | null; note?: string }): Promise<FactRow> {
  if (!(FACT_KEYS as readonly string[]).includes(input.key)) throw new ApiError(422, 'invalid_fact_key', 'Unknown fact type.');
  const norm = normalizeFactValue(input.key, input.value, input.unit ?? null, input.currency ?? null);
  const out = await tx(async (db) => {
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const revision = await bumpRevision(db, caseId);
    const fact = await insertFact(db, caseId, {
      key: input.key,
      subject: input.subject ?? null,
      value: norm.value,
      unit: norm.unit,
      currency: input.currency?.toUpperCase() ?? null,
      spanRefs: [],
      provenance: 'user_statement',
      sourceClass: 'user_statement',
      confidence: 'medium',
      notes: input.note || 'Entered by hand',
      producedBy: 'human',
      evidenceRevision: revision,
    });
    return { fact, revision };
  });
  const run = await requestReassess(caseId, { reason: `You entered ${input.key} by hand`, event: { type: 'fact.corrected', payload: { factRef: out.fact.ref, replacesRef: out.fact.ref, key: out.fact.key } } });
  if (!run) await appendEvent({ caseId, type: 'fact.recorded', producer: 'human', payload: { factRefs: [out.fact.ref], keys: [out.fact.key], by: 'human' }, evidenceRevision: out.revision, idempotencyKey: `fact.manual:${caseId}:${out.fact.ref}` });
  return out.fact;
}

async function addStatementDocument(caseId: string, title: string, body: string): Promise<string> {
  const doc = await addDocument(caseId, { filename: `${title}.txt`, bytes: Buffer.from(body, 'utf8'), kind: 'user_statement', sourceClass: 'user_statement', sourceLabel: 'Your statement (user-provided, not verified)' });
  await parseQueuedDocument(caseId, doc.ref);
  return doc.ref;
}

export async function challengeFinding(caseId: string, findingRef: string, input: { reason: string; expectedRevision?: number }): Promise<{ documentRef: string; reassessQueued: boolean }> {
  const f = await one<{ title: string; status: string }>('select title, status from findings where case_id = $1 and ref = $2', [caseId, findingRef]);
  if (!f) throw new ApiError(404, 'not_found', 'Finding not found');
  const c = await getCase(caseId);
  if (input.expectedRevision !== undefined && input.expectedRevision !== c!.revision) throw new ApiError(409, 'revision_conflict', 'The case changed while you were writing. Refresh and try again.', true);
  const documentRef = await addStatementDocument(caseId, `Challenge to ${findingRef}`, `You challenged the finding "${f.title}" (${findingRef}).\nYour reason: ${input.reason}`);
  await query("update findings set status = 'disputed', change_reason = $3, updated_at = now() where case_id = $1 and ref = $2 and status <> 'superseded'", [caseId, findingRef, `Challenged by you: ${input.reason.slice(0, 200)}`]);
  const run = await requestReassess(caseId, { reason: `You challenged ${findingRef}`, documentRefs: [documentRef], event: { type: 'finding.challenged', payload: { findingRef, reason: input.reason } } });
  if (!run) await appendEvent({ caseId, type: 'finding.challenged', producer: 'human', payload: { findingRef, reason: input.reason }, evidenceRevision: (await getCase(caseId))!.revision, idempotencyKey: `challenge:${caseId}:${findingRef}:${documentRef}` });
  return { documentRef, reassessQueued: !!run };
}

export async function answerQuestion(caseId: string, questionRef: string, input: { answer: string; dontKnow: boolean }): Promise<{ documentRef: string | null; reassessQueued: boolean }> {
  const q = await one<{ prompt: string; audience: string; status: string }>('select prompt, audience, status from questions where case_id = $1 and ref = $2', [caseId, questionRef]);
  if (!q) throw new ApiError(404, 'not_found', 'Question not found');
  if (q.audience !== 'user') throw new ApiError(422, 'not_for_user', 'That question is for the freight company; it goes into the letter.');
  if (input.dontKnow) {
    await query("update questions set status = 'dismissed' where case_id = $1 and ref = $2", [caseId, questionRef]);
    return { documentRef: null, reassessQueued: false };
  }
  const documentRef = await addStatementDocument(caseId, `Answer to ${questionRef}`, `Question (${questionRef}): ${q.prompt}\nYour answer: ${input.answer}`);
  await query("update questions set status = 'answered', answer_fact_ref = $3 where case_id = $1 and ref = $2", [caseId, questionRef, documentRef]);
  const run = await requestReassess(caseId, { reason: `You answered ${questionRef}`, documentRefs: [documentRef], event: { type: 'question.answered', payload: { questionRef, factRef: null } } });
  return { documentRef, reassessQueued: !!run };
}

// ---------------------------------------------------------------- letter

export async function editLetter(caseId: string, baseVersion: number, edits: Record<string, string>): Promise<DraftRow> {
  return tx(async (db) => {
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const cur = await currentDraft(caseId, db);
    if (!cur) throw new ApiError(404, 'no_draft', 'There is no draft yet.');
    if (cur.version !== baseVersion) throw new ApiError(409, 'version_conflict', 'The letter changed since you opened it. Reload to see the latest version.', true);
    const sections = (cur.sections as LetterSectionData[]).map((s) => {
      const t = edits[s.id];
      if (t === undefined || t === s.text) return s;
      return { ...s, text: t, userEdited: t !== s.agentText };
    });
    await query("update letter_drafts set status = 'superseded' where case_id = $1 and status = 'current'", [caseId], db);
    return insertDraft(db, caseId, { status: 'current', sections: sections as LetterSection[], evidenceRevision: cur.evidenceRevision, baseVersion: cur.version, createdBy: 'user', changeSummary: 'Edited by you', runId: null });
  });
}

export async function reconcileLetter(caseId: string, proposalVersion: number, decisions: Record<string, 'accept' | 'keep'>): Promise<DraftRow> {
  return tx(async (db) => {
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const cur = await currentDraft(caseId, db);
    const prop = await pendingProposal(caseId, db);
    if (!cur || !prop || prop.version !== proposalVersion) throw new ApiError(409, 'proposal_changed', 'That proposal is no longer pending.', true);
    const propById = new Map((prop.sections as LetterSectionData[]).map((s) => [s.id, s]));
    let acceptedAny = false;
    const sections = (cur.sections as LetterSectionData[]).map((s) => {
      const p = propById.get(s.id);
      const d = decisions[s.id];
      if (!p || !d) return s;
      if (d === 'accept') {
        acceptedAny = true;
        return { ...s, text: p.text, refs: p.refs, agentText: p.text, userEdited: false };
      }
      return { ...s, agentText: p.text }; // keep the user's wording; remember what the agent last proposed
    });
    await query("update letter_drafts set status = 'superseded' where case_id = $1 and status = 'current'", [caseId], db);
    const next = await insertDraft(db, caseId, { status: 'current', sections: sections as LetterSection[], evidenceRevision: prop.evidenceRevision, baseVersion: cur.version, createdBy: 'user', changeSummary: acceptedAny ? 'You accepted proposed updates' : 'You kept your wording', runId: null });
    await query('update letter_drafts set status = $2 where id = $1', [prop.id, acceptedAny ? 'accepted' : 'rejected'], db);
    return next;
  });
}

// ---------------------------------------------------------------- deletion & account

export async function deleteCase(caseId: string): Promise<void> {
  await deleteCaseCompletely(caseId);
}

export async function deleteAccount(userId: string): Promise<number> {
  const cases = await query<{ id: string }>('select id from cases where owner_id = $1', [userId]);
  for (const c of cases) await deleteCaseCompletely(c.id);
  await query('delete from users where id = $1', [userId]);
  return cases.length;
}

export async function documentOrThrow(caseId: string, ref: string) {
  const d = await getDocument(caseId, ref);
  if (!d) throw new ApiError(404, 'not_found', 'Document not found');
  return d;
}
export { listDocuments };
