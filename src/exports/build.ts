/**
 * Export generation: the complaint letter PDF, the evidence-summary PDF and a CSV of calculations and findings.
 * Exports are stored privately with the draft version and evidence revision they were built from, so a later
 * change to the case can be flagged as "stale".
 */
import { randomUUID } from 'node:crypto';
import { one, query } from '@/db/pool';
import {
  currentDraft,
  getCase,
  listCalculations,
  listDocuments,
  listFacts,
  listFindings,
  listQuestions,
  listRuns,
  listSpans,
  listTimeline,
  latestAssessment,
  putBlob,
  type DocumentRow,
} from '@/db/repo';
import { formatLetterDate, type LetterSectionData } from '@/domain/letter';
import { ASSESSMENT_CLASS_LABEL, DOCUMENT_KIND_LABEL, FACT_KEY_LABEL, SOURCE_CLASS_LABEL, type DocumentKind, type FactKey } from '@/domain/schemas';
import { ApiError } from '@/server/http';
import { COLORS, PdfBuilder } from './pdf-kit';

export const caseCode = (id: string) => `CB-${id.slice(0, 8).toUpperCase()}`;

const DEMO_NOTE = 'Sample case. This pack was prepared from a published regulator report. The invoice and packing list it refers to are reconstructed for demonstration and are not original records; the survey and rate-sheet entries are labelled excerpts or hypothetical illustrations.';

export interface BuiltExport {
  kind: 'complaint_pdf' | 'evidence_summary_pdf' | 'discrepancies_csv';
  filename: string;
  bytes: Uint8Array | Buffer;
  mime: string;
}

async function gather(caseId: string) {
  const c = (await getCase(caseId))!;
  const [draft, docs, facts, calcs, findings, questions, timeline, assessment, runs, spans] = await Promise.all([
    currentDraft(caseId),
    listDocuments(caseId),
    listFacts(caseId, { includeInactive: true }),
    listCalculations(caseId),
    listFindings(caseId, { includeSuperseded: true }),
    listQuestions(caseId),
    listTimeline(caseId),
    latestAssessment(caseId),
    listRuns(caseId),
    listSpans(caseId),
  ]);
  return { c, draft, docs, facts, calcs, findings, questions, timeline, assessment, run: runs[0] ?? null, spans };
}

export async function buildExports(caseId: string): Promise<{ items: BuiltExport[]; draftVersion: number; evidenceRevision: number }> {
  const g = await gather(caseId);
  if (!g.draft) throw new ApiError(409, 'no_draft', 'There is no letter to export yet.');
  const code = caseCode(caseId);
  const v = g.draft.version;
  const sections = g.draft.sections as LetterSectionData[];
  const get = (id: string) => sections.find((s) => s.id === id)?.text ?? '';

  // ------------------------------------------------ complaint letter
  const letter = await PdfBuilder.create({ title: `Request for clarification and review of freight charge — ${code}`, author: 'Prepared with Counterbill; reviewed by sender', subject: g.c.name });
  letter.setFooter(`Prepared with Counterbill; reviewed by sender · ${code} · draft v${v}`);
  if (g.c.isDemo) letter.note(DEMO_NOTE);
  for (const line of get('sender').split('\n')) letter.text(line, { size: 10.5 });
  letter.space(10);
  for (const line of get('recipient').split('\n')) letter.text(line, { size: 10.5 });
  letter.space(10);
  letter.text(`Subject: ${get('subject')}`, { size: 11, bold: true }, { gap: 8 });
  for (const id of ['concern', 'comparison', 'uncertainty', 'requests', 'response']) {
    const t = get(id);
    if (!t) continue;
    for (const p of t.split(/\n{2,}/)) letter.text(p, { size: 10.5 }, { gap: 6 });
  }
  letter.heading('Records referred to', 3);
  for (const line of get('annex').split('\n')) if (line.trim()) letter.text(line, { size: 9.5 });
  letter.space(12);
  letter.ensure(80);
  for (const line of get('closing').split('\n')) letter.text(line, { size: 10.5 });
  const letterBytes = await letter.finish();

  // ------------------------------------------------ evidence summary
  const sum = await PdfBuilder.create({ title: `Evidence summary — ${code}`, author: 'Counterbill', subject: g.c.name });
  sum.setFooter(`Counterbill evidence summary · ${code} · evidence revision ${g.c.revision} · generated ${formatLetterDate(new Date())}`);
  sum.heading('Evidence summary', 1);
  sum.text(g.c.name, { size: 12, bold: true });
  sum.text(`${code} · ${g.c.origin || 'origin unknown'} → ${g.c.destination || 'destination unknown'} · evidence revision ${g.c.revision} · letter draft v${v}`, { size: 9, color: COLORS.muted }, { gap: 6 });
  if (g.c.isDemo) sum.note(DEMO_NOTE);
  const mode = g.run?.inferenceMode === 'test' ? 'TEST MODE: a deterministic stand-in produced the agent outputs, not a live language model.' : `Agent analysis by ${g.run?.model ?? 'a configured model'} through the Mozaik runtime; every figure below was calculated by deterministic code.`;
  sum.note(`A billing difference is not automatically a recoverable overcharge. This summary lists what the documents show and what they do not. It is not legal advice. ${mode}`);
  if (g.draft.evidenceRevision < g.c.revision) {
    sum.note(`Warning: evidence changed after the letter draft was written (draft built at evidence revision ${g.draft.evidenceRevision}; the case is at ${g.c.revision}). Review what changed before relying on the letter.`);
  }
  if (g.assessment) {
    sum.heading('Current reading');
    sum.text(ASSESSMENT_CLASS_LABEL[g.assessment.classification as keyof typeof ASSESSMENT_CLASS_LABEL] ?? g.assessment.classification, { size: 10.5, bold: true });
    sum.text(g.assessment.headline, { size: 10 }, { gap: 3 });
    sum.text(g.assessment.summary, { size: 10 }, { gap: 3 });
    sum.text(`Strongest contrary explanation: ${g.assessment.strongestCounter}`, { size: 9.5, color: COLORS.muted }, { gap: 3 });
  }

  sum.heading('Documents (source register)');
  const docRows = g.docs.map((d: DocumentRow, i: number) => [
    `Annex ${String.fromCharCode(65 + i)} / ${d.ref}`,
    d.originalFilename,
    DOCUMENT_KIND_LABEL[d.kind as DocumentKind] ?? d.kind,
    d.sourceLabel ?? SOURCE_CLASS_LABEL[d.sourceClass as keyof typeof SOURCE_CLASS_LABEL],
    `${d.parseStatus}${d.version > 1 ? ` · v${d.version}` : ''}${d.sha256 ? ` · sha256 ${d.sha256.slice(0, 12)}…` : ''}`,
  ]);
  sum.table(['Ref', 'File', 'Type', 'Source class', 'Status'], docRows, [14, 28, 14, 30, 22]);

  sum.heading('Calculations');
  if (g.calcs.length) {
    sum.table(
      ['Ref', 'Calculation', 'Formula and assumptions'],
      g.calcs.map((k) => [k.ref, `${k.label}\n${k.display}`, `${k.formula}${k.assumptions.length ? `\n${k.assumptions.join(' ')}` : ''}`]),
      [8, 26, 66],
    );
    sum.text('Amounts are comparisons under the stated assumptions. They are not amounts owed or refundable.', { size: 9, color: COLORS.muted }, { gap: 4 });
  } else sum.text('No calculation could be made from the evidence so far.', { size: 10 }, { gap: 4 });

  sum.heading('Findings');
  const spanIndex = new Map(g.spans.map((s) => [s.ref, s]));
  const active = g.findings.filter((f) => f.status !== 'superseded');
  for (const f of active) {
    sum.ensure(60);
    sum.text(`${f.ref} · ${f.title}`, { size: 10.5, bold: true });
    sum.text(`Status: ${f.status} · ${f.severity.replace('_', ' ')} · ${f.category.replace(/_/g, ' ')}${f.basis === 'inference' ? ' · labelled inference' : ''}`, { size: 8.5, color: COLORS.muted });
    sum.text(f.explanation, { size: 9.5 });
    const cites = [...f.factRefs, ...f.calcRefs, ...f.spanRefs];
    if (cites.length) sum.text(`Sources: ${cites.join(', ')}`, { size: 8.5, color: COLORS.muted });
    sum.space(5);
  }
  const superseded = g.findings.filter((f) => f.status === 'superseded');
  if (superseded.length) {
    sum.heading('Earlier readings (superseded)', 3);
    sum.bullets(superseded.map((f) => `${f.ref} (${f.topic}): ${f.title}${f.supersededByRef ? ` — replaced by ${f.supersededByRef}` : ''}${f.changeReason ? `. ${f.changeReason}` : ''}`), 9);
  }

  sum.heading('Source map (facts and where they come from)');
  const activeFacts = g.facts.filter((f) => f.status === 'active');
  sum.table(
    ['Fact', 'What', 'Value', 'Source and quotation'],
    activeFacts.map((f) => {
      const src = f.spanRefs.map((r) => `${r}${spanIndex.get(r) ? '' : ' (?)'}`).join(', ');
      const how = f.provenance === 'user_correction' ? `user-corrected (replaces ${f.correctsRef})` : f.provenance === 'user_statement' ? 'user-provided' : f.provenance;
      return [f.ref, `${FACT_KEY_LABEL[f.key as FactKey] ?? f.key}${f.subject ? ` (${f.subject})` : ''}`, `${f.value}${f.unit ? ` ${f.unit}` : ''}${f.currency ? ` ${f.currency}` : ''}`, `${src || 'no document location'} · ${how}${f.quote ? `\n“${f.quote}”` : ''}`];
    }),
    [7, 21, 15, 57],
  );
  const corrected = g.facts.filter((f) => f.status === 'superseded');
  if (corrected.length) sum.text(`${corrected.length} earlier extracted value(s) were superseded by user corrections and are retained in the case history.`, { size: 9, color: COLORS.muted }, { gap: 4 });

  sum.heading('Timeline');
  if (g.timeline.length) sum.table(['Date', 'Event', 'Source'], g.timeline.map((t) => [t.occurredOn ?? 'Date not established', `${t.description}${t.actor ? ` (${t.actor})` : ''}`, t.spanRefs.join(', ') || '—']), [18, 62, 20]);
  else sum.text('No dated events are established.', { size: 10 }, { gap: 4 });

  sum.heading('Unresolved questions');
  const open = g.questions.filter((q) => q.status === 'open');
  if (open.length) sum.bullets(open.map((q) => `${q.audience === 'user' ? 'For you' : 'For the freight company'}: ${q.prompt} (${q.reason})`), 9.5);
  else sum.text('No open questions.', { size: 10 });
  const summaryBytes = await sum.finish();

  // ------------------------------------------------ csv
  const csvRows: string[][] = [['type', 'ref', 'label', 'value', 'detail', 'status']];
  for (const k of g.calcs) csvRows.push(['calculation', k.ref, k.label, k.output, `${k.formula} [${k.unit}]`, k.status]);
  for (const f of g.findings) csvRows.push(['finding', f.ref, f.title, '', f.explanation, f.status]);
  const csv = csvRows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n');

  return {
    draftVersion: v,
    evidenceRevision: g.c.revision,
    items: [
      { kind: 'complaint_pdf', filename: `Counterbill-${code}-Complaint-v${v}.pdf`, bytes: letterBytes, mime: 'application/pdf' },
      { kind: 'evidence_summary_pdf', filename: `Counterbill-${code}-Evidence-Summary-v${v}.pdf`, bytes: summaryBytes, mime: 'application/pdf' },
      { kind: 'discrepancies_csv', filename: `Counterbill-${code}-Discrepancies-v${v}.csv`, bytes: Buffer.from('﻿' + csv, 'utf8'), mime: 'text/csv; charset=utf-8' },
    ],
  };
}

export async function storeExports(caseId: string, built: Awaited<ReturnType<typeof buildExports>>, reviewed: boolean) {
  const out: { id: string; kind: string; filename: string }[] = [];
  for (const item of built.items) {
    const buf = Buffer.from(item.bytes);
    const key = await putBlob((await import('@/db/pool')).pool(), caseId, buf);
    const id = randomUUID();
    await query(
      'insert into exports(id, case_id, kind, filename, draft_version, evidence_revision, storage_key, size_bytes, reviewed) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, caseId, item.kind, item.filename, built.draftVersion, built.evidenceRevision, key, buf.length, reviewed],
    );
    out.push({ id, kind: item.kind, filename: item.filename });
  }
  await query('update cases set updated_at = now() where id = $1', [caseId]);
  return out;
}

export async function loadExport(caseId: string, exportId: string) {
  const row = await one<{ storage_key: string; filename: string; kind: string }>('select storage_key, filename, kind from exports where id = $1 and case_id = $2', [exportId, caseId]);
  if (!row) return null;
  const blob = await one<{ bytes: Buffer }>('select bytes from document_blobs where storage_key = $1 and case_id = $2', [row.storage_key, caseId]);
  return blob ? { bytes: blob.bytes, filename: row.filename, mime: row.kind.endsWith('csv') ? 'text/csv; charset=utf-8' : 'application/pdf' } : null;
}
