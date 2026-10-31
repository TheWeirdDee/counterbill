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

/** Parse one queued document (called by the document worker, or inline for fixtures). Idempotent per document. */
export async function parseQueuedDocument(caseId: string, ref: string): Promise<DocumentRow | null> {
  const claimed = await one(
    "update documents set parse_status = 'parsing' where case_id = $1 and ref = $2 and parse_status = 'queued' returning *",
    [caseId, ref],
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
         added_at_revision = $9 where case_id = $1 and ref = $2 returning *`,
      [caseId, ref, res.status, res.error ?? res.hint ?? null, res.method, res.ocr, res.confidence, pageCount, revision],
      db,
    );
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

export async function parsePendingDocuments(limit = 5): Promise<{ caseId: string; ref: string }[]> {
  const rows = await query<{ case_id: string; ref: string }>("select case_id, ref from documents where parse_status = 'queued' order by created_at limit $1", [limit]);
  const done: { caseId: string; ref: string }[] = [];
  for (const r of rows) {
    try {
      if (await parseAndReassess(r.case_id, r.ref)) done.push({ caseId: r.case_id, ref: r.ref });
    } catch (e) {
      await query("update documents set parse_status = 'failed', parse_error = $3 where case_id = $1 and ref = $2", [r.case_id, r.ref, `Parsing crashed: ${(e as Error).message.slice(0, 200)}`]);
    }
  }
  return done;
}

export { pool as _pool };
export type { Db };
