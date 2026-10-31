/**
 * Document ingestion: validate → store the original bytes → queue parsing → (worker) extract spans → emit events.
 * Original bytes are immutable; a replacement is a new document version.
 */
import { Db, one, pool, query, tx } from '@/db/pool';
import { appendEvent, bumpRevision, getBlob, getCase, getDocument, insertDocument, insertSpans, putBlob, sha256, touchCase, type DocumentRow } from '@/db/repo';
import { parseDocument, sanitizeFilename, splitIntoSpans, UploadRejected, validateUpload } from '@/docs/parse';
import type { DocumentKind, SourceClass } from '@/domain/schemas';
import { config } from './config';

export function guessKind(filename: string, text = ''): DocumentKind {
  const hay = `${filename} ${text.slice(0, 1500)}`.toLowerCase();
  if (/packing[\s_-]*list/.test(hay)) return 'packing_list';
  if (/survey|measurement|re-?measure/.test(hay)) return 'survey';
  if (/rate[\s_-]*sheet|quotation|quote|tariff/.test(hay)) return 'quote';
  if (/contract|terms and conditions|terms of|agreement/.test(hay)) return 'contract';
  if (/invoice|freight charge|bill of charges/.test(hay)) return 'invoice';
  if (/whatsapp|message|email|\.eml|from:.*to:/.test(hay)) return 'messages';
  return 'other';
}

export interface NewDocument {
  filename: string;
  bytes: Buffer;
  kind?: DocumentKind;
  sourceClass?: SourceClass;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  sourcePublished?: string | null;
  supersedesRef?: string | null;
}

export async function addDocument(caseId: string, d: NewDocument): Promise<DocumentRow> {
  const filename = sanitizeFilename(d.filename);
  const { mime } = validateUpload(filename, d.bytes, config.maxFileBytes);
  return tx(async (db) => {
    // Lock the case first: concurrent uploads would otherwise each pass the quota checks below before either inserts.
    await query('select 1 from cases where id = $1 for update', [caseId], db);
    const existing = await query<{ n: string; total: string }>('select count(*) as n, coalesce(sum(size_bytes),0) as total from documents where case_id = $1', [caseId], db);
    if (Number(existing[0].n) >= config.maxCaseDocuments) throw new UploadRejected('too_many_files', `A case can hold up to ${config.maxCaseDocuments} documents.`);
    if (Number(existing[0].total) + d.bytes.length > config.maxCaseBytes) throw new UploadRejected('case_too_large', `A case can hold up to ${Math.round(config.maxCaseBytes / 1024 / 1024)} MB of documents.`);
    const key = await putBlob(db, caseId, d.bytes);
    const text = mime.startsWith('text') || mime === 'message/rfc822' ? d.bytes.toString('utf8') : '';
    let version = 1;
    if (d.supersedesRef) {
      const prev = await getDocument(caseId, d.supersedesRef, db);
      version = (prev?.version ?? 0) + 1;
    }
    return insertDocument(db, caseId, {
      originalFilename: filename,
      mime,
      sizeBytes: d.bytes.length,
      sha256: sha256(d.bytes),
      kind: d.kind ?? guessKind(filename, text),
      kindSetByUser: !!d.kind,
      sourceClass: d.sourceClass ?? 'primary_document',
      sourceLabel: d.sourceLabel ?? null,
      sourceUrl: d.sourceUrl ?? null,
      sourcePublished: d.sourcePublished ?? null,
      supersedesRef: d.supersedesRef ?? null,
      version,
      parseStatus: 'queued',
      storageKey: key,
    });
  });
}

/** How long a parser may hold a document before another worker treats it as abandoned, and how often to try. */
const PARSE_LEASE_SECONDS = Number(process.env.PARSE_LEASE_SECONDS ?? 300);
const MAX_PARSE_ATTEMPTS = 3;

/** Parse one queued document (called by the document worker, or inline for fixtures). Idempotent per document. */
export async function parseQueuedDocument(caseId: string, ref: string): Promise<DocumentRow | null> {
  const claimed = await one(
    `update documents set parse_status = 'parsing', parse_attempts = parse_attempts + 1,
       parse_lease_expires_at = now() + make_interval(secs => $3)
     where case_id = $1 and ref = $2 and parse_status = 'queued' returning *`,
    [caseId, ref, PARSE_LEASE_SECONDS],
  );
  if (!claimed) return null;
  const doc = await getDocument(caseId, ref);
  if (!doc?.storageKey) return doc;
  const bytes = await getBlob(caseId, doc.storageKey);
  const res = bytes ? await parseDocument(bytes, doc.originalFilename) : { status: 'failed' as const, method: 'none', ocr: false, confidence: null, pages: [], error: 'Stored file is missing.', hint: 'Upload the file again.' };

  return tx(async (db) => {
    let pageCount = 0;
    if (res.pages.length) {
      const pages = res.pages.map((p) => ({ page: p.page, spans: splitIntoSpans(p.text) }));
      pageCount = pages.length;
      await insertSpans(db, caseId, ref, pages);
    }
    const revision = res.status === 'ready' ? await bumpRevision(db, caseId) : (await getCase(caseId, db))!.revision;
    const updated = await one(
      `update documents set parse_status = $3, parse_error = $4, extraction_method = $5, ocr = $6, parse_confidence = $7, page_count = $8,
         added_at_revision = $9, parse_lease_expires_at = null where case_id = $1 and ref = $2 returning *`,
      [caseId, ref, res.status, res.error ?? res.hint ?? null, res.method, res.ocr, res.confidence, pageCount, revision],
      db,
    );
    if (res.status === 'ready' && doc.supersedesRef) await retireReplacedDocument(db, caseId, doc.supersedesRef, ref, revision);
    await appendEvent(
      {
        caseId,
        type: 'evidence.parsed',
        producer: 'system',
        payload: { documentRef: ref, status: res.status, pages: pageCount, method: res.method },
        evidenceRevision: revision,
        idempotencyKey: `parsed:${caseId}:${ref}:${doc.version}`,
      },
      db,
    );
    await touchCase(db, caseId);
    const { camel } = await import('@/db/repo');
    return camel<DocumentRow>(updated!);
  });
}

/** Parse, then (if the case was already investigated) queue a targeted reassessment for the new evidence. */
export async function parseAndReassess(caseId: string, ref: string): Promise<DocumentRow | null> {
  const doc = await parseQueuedDocument(caseId, ref);
  if (doc?.parseStatus === 'ready') {
    const { requestReassess } = await import('./runs');
    await requestReassess(caseId, { reason: `New evidence ${ref} was added`, documentRefs: [ref] });
  }
  return doc;
}

/**
 * A readable replacement is in: the document it replaces leaves the evidence. Facts and timeline entries cited only from
 * the old document are superseded (kept, labelled, never deleted) so they cannot compete with the corrected version.
 */
async function retireReplacedDocument(db: Db, caseId: string, oldRef: string, newRef: string, revision: number) {
  const old = await one(
    'update documents set superseded_by_ref = $3 where case_id = $1 and ref = $2 and superseded_by_ref is null returning ref',
    [caseId, oldRef, newRef],
    db,
  );
  if (!old) return;
  const note = `Document replaced: ${oldRef} was replaced by ${newRef}.`;
  const oldSpans = 'array(select ref from spans where case_id = $1 and document_ref = $2)';
  const facts = await query<{ ref: string }>(
    `update facts set status = 'superseded', notes = $3
     where case_id = $1 and status = 'active' and cardinality(span_refs) > 0 and span_refs <@ ${oldSpans} returning ref`,
    [caseId, oldRef, note],
    db,
  );
  await query(
    `update timeline_events set status = 'superseded'
     where case_id = $1 and status = 'active' and cardinality(span_refs) > 0 and span_refs <@ ${oldSpans}`,
    [caseId, oldRef],
    db,
  );
  await appendEvent(
    {
      caseId,
      type: 'evidence.superseded',
      producer: 'system',
      payload: { documentRef: oldRef, replacedBy: newRef, supersededFacts: facts.map((f) => f.ref) },
      evidenceRevision: revision,
      idempotencyKey: `superseded:${caseId}:${oldRef}:${newRef}`,
    },
    db,
  );
}

/**
 * Parsing claimed by a worker that then stopped (restart, crash) would stay 'parsing' forever and block every run on the
 * case. Expired claims go back to the queue; a document that has already used all its attempts is failed with a reason.
 */
export async function recoverAbandonedParses(): Promise<number> {
  const failed = await query(
    `update documents set parse_status = 'failed', parse_lease_expires_at = null,
       parse_error = 'Reading this file was interrupted repeatedly. Upload it again, or try a different format.'
     where parse_status = 'parsing' and (parse_lease_expires_at is null or parse_lease_expires_at < now()) and parse_attempts >= $1
     returning ref`,
    [MAX_PARSE_ATTEMPTS],
  );
  const requeued = await query(
    `update documents set parse_status = 'queued', parse_lease_expires_at = null
     where parse_status = 'parsing' and (parse_lease_expires_at is null or parse_lease_expires_at < now()) returning ref`,
  );
  return failed.length + requeued.length;
}

export async function parsePendingDocuments(limit = 5): Promise<{ caseId: string; ref: string }[]> {
  await recoverAbandonedParses();
  const rows = await query<{ case_id: string; ref: string }>("select case_id, ref from documents where parse_status = 'queued' order by created_at limit $1", [limit]);
  const done: { caseId: string; ref: string }[] = [];
  for (const r of rows) {
    try {
      if (await parseAndReassess(r.case_id, r.ref)) done.push({ caseId: r.case_id, ref: r.ref });
    } catch (e) {
      await query("update documents set parse_status = 'failed', parse_lease_expires_at = null, parse_error = $3 where case_id = $1 and ref = $2", [r.case_id, r.ref, `Parsing crashed: ${(e as Error).message.slice(0, 200)}`]);
    }
  }
  return done;
}

export { pool as _pool };
export type { Db };
