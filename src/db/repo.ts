/**
 * Persistence for cases and everything that hangs off them. All reads/writes are keyed by case id;
 * callers (API routes, workers) are responsible for the ownership check that precedes them.
 */
import { createHash, randomUUID } from 'node:crypto';
import { contentHash } from '@/domain/case-rules';
import type { EvidenceIndex } from '@/domain/citations';
import { emptyIndex } from '@/domain/citations';
import { Db, one, pool, query, tx } from './pool';

export function camel<T = Record<string, unknown>>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v instanceof Date ? v.toISOString() : v;
  }
  return out as T;
}
const camelAll = <T>(rows: Record<string, unknown>[]) => rows.map((r) => camel<T>(r));

// ---------------------------------------------------------------- record types

export interface CaseRow {
  id: string;
  ownerId: string | null;
  isDemo: boolean;
  demoSlug: string | null;
  name: string;
  claimant: string;
  counterparty: string;
  origin: string;
  destination: string;
  shipmentClass: string;
  currency: string;
  billedAmount: string;
  quoteCurrency: string;
  concern: string;
  status: string;
  archived: boolean;
  revision: number;
  sampleLabel: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DocumentRow {
  caseId: string;
  ref: string;
  id: string;
  kind: string;
  kindSetByUser: boolean;
  sourceClass: string;
  sourceLabel: string | null;
  sourceUrl: string | null;
  sourcePublished: string | null;
  originalFilename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  version: number;
  supersedesRef: string | null;
  parseStatus: string;
  parseError: string | null;
  extractionMethod: string | null;
  ocr: boolean;
  parseConfidence: string | null;
  pageCount: number;
  storageKey: string | null;
  addedAtRevision: number;
  createdAt: string;
}
export interface SpanRow {
  caseId: string;
  ref: string;
  documentRef: string;
  page: number;
  idx: number;
  startOffset: number;
  endOffset: number;
  text: string;
}
export interface FactRow {
  caseId: string;
  ref: string;
  key: string;
  subject: string | null;
  value: string;
  unit: string | null;
  currency: string | null;
  spanRefs: string[];
  quote: string | null;
  provenance: string;
  sourceClass: string | null;
  status: string;
  confidence: string | null;
  notes: string | null;
  correctsRef: string | null;
  correctionNote: string | null;
  producedBy: string;
  runId: string | null;
  evidenceRevision: number;
  createdAt: string;
}
export interface CalcRow {
  caseId: string;
  ref: string;
  topic: string;
  kind: string;
  label: string;
  formula: string;
  inputFactRefs: string[];
  assumptions: string[];
  output: string;
  unit: string;
  display: string;
  caveat: string | null;
  status: string;
  supersedesRef: string | null;
  inputHash: string;
  producedBy: string;
  runId: string | null;
  evidenceRevision: number;
  createdAt: string;
}
export interface FindingRow {
  caseId: string;
  ref: string;
  topic: string;
  title: string;
  category: string;
  status: string;
  severity: string;
  explanation: string;
  factRefs: string[];
  calcRefs: string[];
  spanRefs: string[];
  basis: string;
  supersedesRef: string | null;
  supersededByRef: string | null;
  changeReason: string | null;
  contentHash: string;
  producedBy: string;
  runId: string | null;
  evidenceRevision: number;
  createdAt: string;
  updatedAt: string;
}
export interface QuestionRow {
  caseId: string;
  ref: string;
  audience: string;
  prompt: string;
  reason: string;
  status: string;
  answerFactRef: string | null;
  dedupeKey: string;
  raisedBy: string;
  runId: string | null;
  evidenceRevision: number;
  createdAt: string;
}
export interface TimelineRow {
  caseId: string;
  ref: string;
  occurredOn: string | null;
  datePrecision: string;
  actor: string | null;
  description: string;
  spanRefs: string[];
  kind: string;
  status: string;
  evidenceRevision: number;
}
export interface InterpretationRow {
  caseId: string;
  ref: string;
  termsStatus: string;
  summary: string;
  clauseFactRefs: string[];
  challenges: { targetTopic: string; reason: string; spanRefs: string[] }[];
  affectsCalculation: boolean;
  status: string;
  producedBy: string;
  evidenceRevision: number;
  createdAt: string;
}
export interface AssessmentRow {
  caseId: string;
  version: number;
  classification: string;
  headline: string;
  summary: string;
  strongestCounter: string;
  changeReason: string | null;
  changeDiff: Record<string, unknown>;
  nextAction: string;
  readiness: string;
  runId: string | null;
  evidenceRevision: number;
  createdAt: string;
}
export interface RunRow {
  id: string;
  caseId: string;
  kind: string;
  status: string;
  evidenceRevision: number;
  trigger: Record<string, unknown>;
  targetedAgents: string[];
  inferenceMode: string;
  model: string | null;
  workerId: string | null;
  leaseExpiresAt: string | null;
  cancelRequested: boolean;
  cancelReason: string | null;
  parentRunId: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  modelCalls: number;
}
export interface AgentRunRow {
  id: string;
  runId: string;
  caseId: string;
  agentRole: string;
  taskLabel: string;
  mozaikAgentId: string;
  mozaikLoopId: string | null;
  status: string;
  attempt: number;
  triggerEventId: string | null;
  evidenceRevision: number;
  modelName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  resultSummary: string | null;
  error: string | null;
  startedAt: string;
  inferenceStartedAt: string | null;
  inferenceFinishedAt: string | null;
  finishedAt: string | null;
}
export interface EventRow {
  seq: string;
  id: string;
  caseId: string;
  runId: string | null;
  type: string;
  producer: string;
  payload: Record<string, unknown>;
  causationId: string | null;
  correlationId: string | null;
  evidenceRevision: number;
  idempotencyKey: string;
  occurredAt: string;
}
export interface LetterSection {
  id: string;
  title: string;
  text: string;
  refs: string[];
  /** Latest text the agent/system proposed for this section (what "Keep my wording" is measured against). */
  agentText: string;
  userEdited: boolean;
}
export interface DraftRow {
  id: string;
  caseId: string;
  version: number;
  status: 'current' | 'superseded' | 'proposed' | 'rejected' | 'accepted';
  sections: LetterSection[];
  evidenceRevision: number;
  baseVersion: number | null;
  createdBy: string;
  changeSummary: string | null;
  runId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------- refs & events

export async function nextRef(db: Db, caseId: string, prefix: string): Promise<string> {
  const row = await one<{ n: number }>(
    `insert into case_counters(case_id, prefix, n) values ($1, $2, 1)
     on conflict (case_id, prefix) do update set n = case_counters.n + 1 returning n`,
    [caseId, prefix],
    db,
  );
  return `${prefix}${row!.n}`;
}

export interface NewEvent {
  caseId: string;
  runId?: string | null;
  type: string;
  producer: string;
  payload?: Record<string, unknown>;
  causationId?: string | null;
  correlationId?: string | null;
  evidenceRevision: number;
  idempotencyKey: string;
}

/** Append-only. A repeated idempotencyKey returns the stored event and `inserted: false`. */
export async function appendEvent(ev: NewEvent, db: Db = pool()): Promise<{ event: EventRow; inserted: boolean }> {
  const id = randomUUID();
  const rows = await query(
    `insert into case_events(id, case_id, run_id, type, producer, payload, causation_id, correlation_id, evidence_revision, idempotency_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (idempotency_key) do nothing returning *`,
    [id, ev.caseId, ev.runId ?? null, ev.type, ev.producer, JSON.stringify(ev.payload ?? {}), ev.causationId ?? null, ev.correlationId ?? null, ev.evidenceRevision, ev.idempotencyKey],
    db,
  );
  if (rows[0]) return { event: camel<EventRow>(rows[0]), inserted: true };
  const existing = await one('select * from case_events where idempotency_key = $1', [ev.idempotencyKey], db);
  return { event: camel<EventRow>(existing!), inserted: false };
}

export async function listEvents(caseId: string, afterSeq: number, limit = 500, db: Db = pool()): Promise<EventRow[]> {
  return camelAll<EventRow>(await query('select * from case_events where case_id = $1 and seq > $2 order by seq asc limit $3', [caseId, afterSeq, limit], db));
}

// ---------------------------------------------------------------- cases

export async function getCase(id: string, db: Db = pool()): Promise<CaseRow | null> {
  const row = await one('select * from cases where id = $1', [id], db);
  return row ? camel<CaseRow>(row) : null;
}

export async function createCase(
  input: Partial<CaseRow> & { name: string },
  actor: { ownerId: string } | { demoTokenHash: string },
  db: Db = pool(),
): Promise<CaseRow> {
  const row = await one(
    `insert into cases(owner_id, is_demo, demo_slug, demo_token_hash, name, claimant, counterparty, origin, destination, shipment_class,
       currency, billed_amount, quote_currency, concern, status, sample_label)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
    [
      'ownerId' in actor ? actor.ownerId : null,
      'demoTokenHash' in actor,
      input.demoSlug ?? null,
      'demoTokenHash' in actor ? actor.demoTokenHash : null,
      input.name,
      input.claimant ?? '',
      input.counterparty ?? '',
      input.origin ?? '',
      input.destination ?? '',
      input.shipmentClass ?? 'unknown',
      input.currency ?? 'NGN',
      input.billedAmount ?? '',
      input.quoteCurrency ?? '',
      input.concern ?? '',
      input.status ?? 'draft',
      input.sampleLabel ?? null,
    ],
    db,
  );
  return camel<CaseRow>(row!);
}

export async function listCasesForOwner(ownerId: string, search?: string): Promise<(CaseRow & { differenceDisplay: string | null; openQuestions: number })[]> {
  const rows = await query(
    `select c.*,
       (select display from calculations k where k.case_id = c.id and k.kind = 'charge_difference' and k.status = 'current'
          order by k.created_at desc limit 1) as difference_display,
       (select count(*)::int from questions q where q.case_id = c.id and q.status = 'open' and q.audience = 'user') as open_questions
     from cases c where c.owner_id = $1 and ($2::text is null or c.name ilike $2 or c.claimant ilike $2 or c.counterparty ilike $2)
     order by c.updated_at desc limit 200`,
    [ownerId, search ? `%${search.replace(/[%_]/g, '')}%` : null],
  );
  return camelAll(rows);
}

export async function touchCase(db: Db, caseId: string, patch: { status?: string } = {}): Promise<void> {
  await query('update cases set updated_at = now(), status = coalesce($2, status) where id = $1', [caseId, patch.status ?? null], db);
}

/** Increment the evidence revision. Only material changes (new/changed evidence) call this. */
export async function bumpRevision(db: Db, caseId: string): Promise<number> {
  const row = await one<{ revision: number }>('update cases set revision = revision + 1, updated_at = now() where id = $1 returning revision', [caseId], db);
  return row!.revision;
}

export async function deleteCaseCompletely(caseId: string): Promise<void> {
  // document_blobs, exports and every child table cascade from cases; exports' bytes live in document_blobs.
  await tx(async (db) => {
    await query('delete from document_blobs where case_id = $1', [caseId], db);
    await query('delete from cases where id = $1', [caseId], db);
  });
}

// ---------------------------------------------------------------- documents & spans

export async function putBlob(db: Db, caseId: string, bytes: Buffer): Promise<string> {
  const key = `${caseId}/${randomUUID()}`;
  await query('insert into document_blobs(storage_key, case_id, bytes) values ($1,$2,$3)', [key, caseId, bytes], db);
  return key;
}
export async function getBlob(caseId: string, key: string, db: Db = pool()): Promise<Buffer | null> {
  const row = await one<{ bytes: Buffer }>('select bytes from document_blobs where storage_key = $1 and case_id = $2', [key, caseId], db);
  return row?.bytes ?? null;
}

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function insertDocument(
  db: Db,
  caseId: string,
  d: Partial<DocumentRow> & { originalFilename: string },
): Promise<DocumentRow> {
  const ref = await nextRef(db, caseId, 'D');
  const row = await one(
    `insert into documents(case_id, ref, kind, kind_set_by_user, source_class, source_label, source_url, source_published, original_filename, mime,
       size_bytes, sha256, version, supersedes_ref, parse_status, parse_error, extraction_method, ocr, parse_confidence, page_count, storage_key, added_at_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning *`,
    [
      caseId, ref, d.kind ?? 'other', d.kindSetByUser ?? false, d.sourceClass ?? 'primary_document', d.sourceLabel ?? null, d.sourceUrl ?? null,
      d.sourcePublished ?? null, d.originalFilename, d.mime ?? 'application/octet-stream', d.sizeBytes ?? 0, d.sha256 ?? '', d.version ?? 1,
      d.supersedesRef ?? null, d.parseStatus ?? 'uploaded', d.parseError ?? null, d.extractionMethod ?? null, d.ocr ?? false,
      d.parseConfidence ?? null, d.pageCount ?? 0, d.storageKey ?? null, d.addedAtRevision ?? 0,
    ],
    db,
  );
  return camel<DocumentRow>(row!);
}

export async function insertSpans(
  db: Db,
  caseId: string,
  documentRef: string,
  pages: { page: number; spans: { text: string; start: number; end: number }[] }[],
): Promise<number> {
  let count = 0;
  for (const p of pages) {
    let idx = 0;
    for (const s of p.spans) {
      idx += 1;
      await query(
        'insert into spans(case_id, ref, document_ref, page, idx, start_offset, end_offset, text) values ($1,$2,$3,$4,$5,$6,$7,$8)',
        [caseId, `${documentRef}-p${p.page}-s${idx}`, documentRef, p.page, idx, s.start, s.end, s.text],
        db,
      );
      count++;
    }
  }
  return count;
}

export async function listDocuments(caseId: string, db: Db = pool()): Promise<DocumentRow[]> {
  return camelAll(await query('select * from documents where case_id = $1 order by created_at, ref', [caseId], db));
}
export async function getDocument(caseId: string, ref: string, db: Db = pool()): Promise<DocumentRow | null> {
  const r = await one('select * from documents where case_id = $1 and ref = $2', [caseId, ref], db);
  return r ? camel<DocumentRow>(r) : null;
}
export async function listSpans(caseId: string, documentRef?: string, db: Db = pool()): Promise<SpanRow[]> {
  return camelAll(
    await query(
      `select * from spans where case_id = $1 and ($2::text is null or document_ref = $2) order by document_ref, page, idx`,
      [caseId, documentRef ?? null],
      db,
    ),
  );
}

// ---------------------------------------------------------------- facts

export async function insertFact(db: Db, caseId: string, f: Partial<FactRow> & { key: string; value: string; provenance: string; producedBy: string; evidenceRevision: number }): Promise<FactRow> {
  const ref = await nextRef(db, caseId, 'F');
  const row = await one(
    `insert into facts(case_id, ref, key, subject, value, unit, currency, span_refs, quote, provenance, source_class, status, confidence, notes,
       corrects_ref, correction_note, produced_by, run_id, evidence_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) returning *`,
    [
      caseId, ref, f.key, f.subject ?? null, f.value, f.unit ?? null, f.currency ?? null, f.spanRefs ?? [], f.quote ?? null, f.provenance,
      f.sourceClass ?? null, f.status ?? 'active', f.confidence ?? null, f.notes ?? null, f.correctsRef ?? null, f.correctionNote ?? null,
      f.producedBy, f.runId ?? null, f.evidenceRevision,
    ],
    db,
  );
  return camel<FactRow>(row!);
}

export async function listFacts(caseId: string, opts: { includeInactive?: boolean } = {}, db: Db = pool()): Promise<FactRow[]> {
  return camelAll(
    await query(
      `select * from facts where case_id = $1 ${opts.includeInactive ? '' : "and status = 'active'"} order by length(ref), ref`,
      [caseId],
      db,
    ),
  );
}

/** Facts already recorded with the same key/subject/value/spans are not recorded twice (idempotent reruns). */
export async function findEquivalentFact(db: Db, caseId: string, f: { key: string; subject: string | null; value: string; spanRefs: string[] }): Promise<FactRow | null> {
  const r = await one(
    `select * from facts where case_id = $1 and key = $2 and coalesce(subject,'') = coalesce($3,'') and value = $4 and span_refs = $5 and status = 'active' limit 1`,
    [caseId, f.key, f.subject, f.value, f.spanRefs],
    db,
  );
  return r ? camel<FactRow>(r) : null;
}

// ---------------------------------------------------------------- calculations

export async function upsertCalculation(
  db: Db,
  caseId: string,
  c: { topic: string; kind: string; label: string; formula: string; inputFactRefs: string[]; assumptions: string[]; output: string; unit: string; display: string; caveat?: string | null },
  meta: { producedBy: string; runId: string | null; evidenceRevision: number },
): Promise<{ calc: CalcRow; changed: boolean }> {
  const inputHash = contentHash({ f: c.formula, o: c.output, i: c.inputFactRefs });
  const current = await one('select * from calculations where case_id = $1 and topic = $2 and status = $3', [caseId, c.topic, 'current'], db);
  if (current && (current as { input_hash: string }).input_hash === inputHash) return { calc: camel<CalcRow>(current), changed: false };
  const ref = await nextRef(db, caseId, 'C');
  const row = await one(
    `insert into calculations(case_id, ref, topic, kind, label, formula, input_fact_refs, assumptions, output, unit, display, caveat, status, supersedes_ref,
       input_hash, produced_by, run_id, evidence_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'current',$13,$14,$15,$16,$17) returning *`,
    [caseId, ref, c.topic, c.kind, c.label, c.formula, c.inputFactRefs, JSON.stringify(c.assumptions), c.output, c.unit, c.display, c.caveat ?? null,
      current ? (current as { ref: string }).ref : null, inputHash, meta.producedBy, meta.runId, meta.evidenceRevision],
    db,
  );
  if (current) await query("update calculations set status = 'superseded' where case_id = $1 and ref = $2", [caseId, (current as { ref: string }).ref], db);
  return { calc: camel<CalcRow>(row!), changed: true };
}

export async function listCalculations(caseId: string, opts: { all?: boolean } = {}, db: Db = pool()): Promise<CalcRow[]> {
  return camelAll(
    await query(`select * from calculations where case_id = $1 ${opts.all ? '' : "and status = 'current'"} order by length(ref), ref`, [caseId], db),
  );
}

// ---------------------------------------------------------------- findings

export interface FindingInput {
  topic: string;
  title: string;
  category: string;
  status: string;
  severity: string;
  explanation: string;
  factRefs: string[];
  calcRefs: string[];
  spanRefs: string[];
  basis: string;
}

/**
 * Apply a finding by topic. Identical content is a no-op (idempotent); different content creates a new
 * finding that supersedes the active one, preserving the earlier interpretation.
 */
export async function applyFinding(
  db: Db,
  caseId: string,
  f: FindingInput,
  meta: { producedBy: string; runId: string | null; evidenceRevision: number; reason?: string | null },
): Promise<{ finding: FindingRow; outcome: 'created' | 'revised' | 'unchanged'; previous: FindingRow | null }> {
  const hash = contentHash({ ...f, factRefs: [...f.factRefs].sort(), calcRefs: [...f.calcRefs].sort(), spanRefs: [...f.spanRefs].sort() });
  const cur = await one(`select * from findings where case_id = $1 and topic = $2 and status <> 'superseded' order by created_at desc limit 1 for update`, [caseId, f.topic], db);
  if (cur && (cur as { content_hash: string }).content_hash === hash) return { finding: camel<FindingRow>(cur), outcome: 'unchanged', previous: null };
  const ref = await nextRef(db, caseId, 'FN');
  const row = await one(
    `insert into findings(case_id, ref, topic, title, category, status, severity, explanation, fact_refs, calc_refs, span_refs, basis, supersedes_ref,
       change_reason, content_hash, produced_by, run_id, evidence_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning *`,
    [caseId, ref, f.topic, f.title, f.category, f.status, f.severity, f.explanation, f.factRefs, f.calcRefs, f.spanRefs, f.basis,
      cur ? (cur as { ref: string }).ref : null, meta.reason ?? null, hash, meta.producedBy, meta.runId, meta.evidenceRevision],
    db,
  );
  if (cur) {
    await query("update findings set status = 'superseded', superseded_by_ref = $3, updated_at = now() where case_id = $1 and ref = $2", [caseId, (cur as { ref: string }).ref, ref], db);
  }
  return { finding: camel<FindingRow>(row!), outcome: cur ? 'revised' : 'created', previous: cur ? camel<FindingRow>(cur) : null };
}

export async function setFindingStatus(db: Db, caseId: string, ref: string, status: string, reason: string): Promise<FindingRow | null> {
  const row = await one(
    `update findings set status = $3, change_reason = $4, updated_at = now() where case_id = $1 and ref = $2 returning *`,
    [caseId, ref, status, reason],
    db,
  );
  return row ? camel<FindingRow>(row) : null;
}

export async function listFindings(caseId: string, opts: { includeSuperseded?: boolean } = {}, db: Db = pool()): Promise<FindingRow[]> {
  return camelAll(
    await query(
      `select * from findings where case_id = $1 ${opts.includeSuperseded ? '' : "and status <> 'superseded'"} order by length(ref), ref`,
      [caseId],
      db,
    ),
  );
}

// ---------------------------------------------------------------- questions, timeline, interpretations, assessments

export async function addQuestion(
  db: Db,
  caseId: string,
  q: { audience: string; prompt: string; reason: string },
  meta: { raisedBy: string; runId: string | null; evidenceRevision: number },
): Promise<{ question: QuestionRow; inserted: boolean }> {
  const dedupe = contentHash({ a: q.audience, p: q.prompt.toLowerCase().replace(/\W+/g, ' ').trim() });
  const existing = await one('select * from questions where case_id = $1 and dedupe_key = $2', [caseId, dedupe], db);
  if (existing) return { question: camel<QuestionRow>(existing), inserted: false };
  const ref = await nextRef(db, caseId, 'Q');
  const row = await one(
    `insert into questions(case_id, ref, audience, prompt, reason, dedupe_key, raised_by, run_id, evidence_revision) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [caseId, ref, q.audience, q.prompt, q.reason, dedupe, meta.raisedBy, meta.runId, meta.evidenceRevision],
    db,
  );
  return { question: camel<QuestionRow>(row!), inserted: true };
}
export async function listQuestions(caseId: string, db: Db = pool()): Promise<QuestionRow[]> {
  return camelAll(await query('select * from questions where case_id = $1 order by length(ref), ref', [caseId], db));
}

export async function addTimelineEvent(
  db: Db,
  caseId: string,
  e: { occurredOn: string | null; datePrecision: string; actor: string | null; description: string; spanRefs: string[]; kind?: string },
  meta: { runId: string | null; evidenceRevision: number },
): Promise<{ row: TimelineRow; inserted: boolean }> {
  const dedupe = contentHash({ d: e.occurredOn, t: e.description.toLowerCase().replace(/\W+/g, ' ').trim(), k: e.kind ?? 'event' });
  const existing = await one('select * from timeline_events where case_id = $1 and dedupe_key = $2', [caseId, dedupe], db);
  if (existing) return { row: camel<TimelineRow>(existing), inserted: false };
  const ref = await nextRef(db, caseId, 'T');
  const row = await one(
    `insert into timeline_events(case_id, ref, occurred_on, date_precision, actor, description, span_refs, kind, dedupe_key, run_id, evidence_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [caseId, ref, e.occurredOn, e.datePrecision, e.actor, e.description, e.spanRefs, e.kind ?? 'event', dedupe, meta.runId, meta.evidenceRevision],
    db,
  );
  return { row: camel<TimelineRow>(row!), inserted: true };
}
export async function listTimeline(caseId: string, db: Db = pool()): Promise<TimelineRow[]> {
  return camelAll(await query("select * from timeline_events where case_id = $1 and status = 'active' order by occurred_on nulls last, length(ref), ref", [caseId], db));
}

export async function addInterpretation(
  db: Db,
  caseId: string,
  i: { termsStatus: string; summary: string; clauseFactRefs: string[]; challenges: unknown[]; affectsCalculation: boolean },
  meta: { producedBy: string; runId: string | null; evidenceRevision: number },
): Promise<InterpretationRow> {
  await query("update interpretations set status = 'superseded' where case_id = $1 and status = 'current'", [caseId], db);
  const ref = await nextRef(db, caseId, 'I');
  const row = await one(
    `insert into interpretations(case_id, ref, terms_status, summary, clause_fact_refs, challenges, affects_calculation, produced_by, run_id, evidence_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [caseId, ref, i.termsStatus, i.summary, i.clauseFactRefs, JSON.stringify(i.challenges), i.affectsCalculation, meta.producedBy, meta.runId, meta.evidenceRevision],
    db,
  );
  return camel<InterpretationRow>(row!);
}
export async function currentInterpretation(caseId: string, db: Db = pool()): Promise<InterpretationRow | null> {
  const r = await one("select * from interpretations where case_id = $1 and status = 'current' order by created_at desc limit 1", [caseId], db);
  return r ? camel<InterpretationRow>(r) : null;
}

export async function latestAssessment(caseId: string, db: Db = pool()): Promise<AssessmentRow | null> {
  const r = await one('select * from assessments where case_id = $1 order by version desc limit 1', [caseId], db);
  return r ? camel<AssessmentRow>(r) : null;
}
export async function listAssessments(caseId: string, db: Db = pool()): Promise<AssessmentRow[]> {
  return camelAll(await query('select * from assessments where case_id = $1 order by version desc', [caseId], db));
}
export async function insertAssessment(db: Db, caseId: string, a: Omit<AssessmentRow, 'caseId' | 'version' | 'createdAt'>): Promise<AssessmentRow> {
  const v = await one<{ v: number }>('select coalesce(max(version),0)+1 as v from assessments where case_id = $1', [caseId], db);
  const row = await one(
    `insert into assessments(case_id, version, classification, headline, summary, strongest_counter, change_reason, change_diff, next_action, readiness, run_id, evidence_revision)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
    [caseId, v!.v, a.classification, a.headline, a.summary, a.strongestCounter, a.changeReason, JSON.stringify(a.changeDiff ?? {}), a.nextAction, a.readiness, a.runId, a.evidenceRevision],
    db,
  );
  return camel<AssessmentRow>(row!);
}

// ---------------------------------------------------------------- runs

export async function createRun(
  db: Db,
  r: { caseId: string; kind: string; evidenceRevision: number; trigger: Record<string, unknown>; targetedAgents?: string[]; inferenceMode: string; model: string | null; parentRunId?: string | null },
): Promise<RunRow> {
  const row = await one(
    `insert into investigation_runs(case_id, kind, evidence_revision, trigger, targeted_agents, inference_mode, model, parent_run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [r.caseId, r.kind, r.evidenceRevision, JSON.stringify(r.trigger), r.targetedAgents ?? [], r.inferenceMode, r.model, r.parentRunId ?? null],
    db,
  );
  return camel<RunRow>(row!);
}
export async function getRun(id: string, db: Db = pool()): Promise<RunRow | null> {
  const r = await one('select * from investigation_runs where id = $1', [id], db);
  return r ? camel<RunRow>(r) : null;
}
export async function listRuns(caseId: string, db: Db = pool()): Promise<RunRow[]> {
  return camelAll(await query('select * from investigation_runs where case_id = $1 order by queued_at desc limit 50', [caseId], db));
}
export async function activeOrQueuedRun(caseId: string, db: Db = pool()): Promise<RunRow | null> {
  const r = await one("select * from investigation_runs where case_id = $1 and status in ('queued','running') order by queued_at desc limit 1", [caseId], db);
  return r ? camel<RunRow>(r) : null;
}
export async function listAgentRuns(caseId: string, runId?: string, db: Db = pool()): Promise<AgentRunRow[]> {
  return camelAll(
    await query('select * from agent_runs where case_id = $1 and ($2::uuid is null or run_id = $2) order by started_at, id', [caseId, runId ?? null], db),
  );
}

// ---------------------------------------------------------------- letters

export async function currentDraft(caseId: string, db: Db = pool()): Promise<DraftRow | null> {
  const r = await one("select * from letter_drafts where case_id = $1 and status = 'current' order by version desc limit 1", [caseId], db);
  return r ? camel<DraftRow>(r) : null;
}
export async function pendingProposal(caseId: string, db: Db = pool()): Promise<DraftRow | null> {
  const r = await one("select * from letter_drafts where case_id = $1 and status = 'proposed' order by version desc limit 1", [caseId], db);
  return r ? camel<DraftRow>(r) : null;
}
export async function listDrafts(caseId: string, db: Db = pool()): Promise<DraftRow[]> {
  return camelAll(await query('select * from letter_drafts where case_id = $1 order by version desc limit 100', [caseId], db));
}
export async function insertDraft(
  db: Db,
  caseId: string,
  d: { status: string; sections: LetterSection[]; evidenceRevision: number; baseVersion: number | null; createdBy: string; changeSummary: string | null; runId: string | null },
): Promise<DraftRow> {
  await query('select 1 from cases where id = $1 for update', [caseId], db);
  const v = await one<{ v: number }>('select coalesce(max(version),0)+1 as v from letter_drafts where case_id = $1', [caseId], db);
  const row = await one(
    `insert into letter_drafts(case_id, version, status, sections, evidence_revision, base_version, created_by, change_summary, run_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [caseId, v!.v, d.status, JSON.stringify(d.sections), d.evidenceRevision, d.baseVersion, d.createdBy, d.changeSummary, d.runId],
    db,
  );
  return camel<DraftRow>(row!);
}

// ---------------------------------------------------------------- evidence index

export async function buildEvidenceIndex(caseId: string, db: Db = pool()): Promise<EvidenceIndex> {
  const idx = emptyIndex();
  const docs = await query('select ref from documents where case_id = $1', [caseId], db);
  const spans = await query('select ref, document_ref, text from spans where case_id = $1', [caseId], db);
  const facts = await query('select ref, status from facts where case_id = $1', [caseId], db);
  const calcs = await query('select ref from calculations where case_id = $1', [caseId], db);
  const finds = await query('select ref from findings where case_id = $1', [caseId], db);
  const qs = await query('select ref from questions where case_id = $1', [caseId], db);
  docs.forEach((r) => idx.documents.add(r.ref as string));
  spans.forEach((r) => idx.spans.set(r.ref as string, { documentRef: r.document_ref as string, text: r.text as string }));
  facts.forEach((r) => idx.facts.set(r.ref as string, { status: r.status as string }));
  calcs.forEach((r) => idx.calculations.add(r.ref as string));
  finds.forEach((r) => idx.findings.add(r.ref as string));
  qs.forEach((r) => idx.questions.add(r.ref as string));
  return idx;
}
