/**
 * The defining behaviour: new evidence changes the investigation and the complaint, with a recorded reason.
 * Every run here is a REAL worker process hosting the REAL Mozaik runtime against REAL PostgreSQL. Only the model call
 * is the labelled deterministic test runner (COUNTERBILL_INFERENCE=test); this proves orchestration, not model quality.
 */
import { events, letterText, latestRun, ms, runQueued, setupDb, snapshot, teardownDb, addText } from './helpers';
import { currentDraft, latestAssessment, listAssessments, listDrafts, listSpans } from '@/db/repo';
import { createDemoCaseInstance, addDemoEvidence } from '@/server/demo';
import { correctFact } from '@/server/case-actions';
import { startInvestigation } from '@/server/runs';
import { buildExports } from '@/exports/build';
import { forbiddenLanguage } from '@/domain/case-rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { extractText, getDocumentProxy } from 'unpdf';

let caseId = '';

beforeAll(async () => {
  await setupDb();
});
afterAll(teardownDb);

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text as string;
}

describe('first investigation: genuinely concurrent Mozaik loops', () => {
  it('starts the first-wave agents together, with distinct loop ids and overlapping spans', async () => {
    const c = await createDemoCaseInstance('volume-dispute-aug-2026', 'story-token');
    caseId = c.id;
    const { run } = await startInvestigation(caseId);
    const r = await runQueued(run.id);
    expect(r.code).toBe(0);

    const s = await snapshot(caseId);
    const first = ['evidence', 'billing', 'contract', 'timeline'].map((role) => s.agentRuns.find((a) => a.agentRole === role)!);
    expect(first.every(Boolean)).toBe(true);

    // started within a few hundred ms of one another, off the same case.started event
    const starts = first.map((a) => ms(a.startedAt));
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(600);

    // each ran its own Mozaik loop
    const loops = first.map((a) => a.mozaikLoopId);
    expect(loops.every((l) => !!l)).toBe(true);
    expect(new Set(loops).size).toBe(4);

    // overlap measured from recorded start/finish
    let overlapping = 0;
    for (let i = 0; i < first.length; i++)
      for (let j = i + 1; j < first.length; j++) {
        const a = first[i];
        const b = first[j];
        if (Math.min(ms(a.finishedAt), ms(b.finishedAt)) > Math.max(ms(a.startedAt), ms(b.startedAt))) overlapping++;
      }
    expect(overlapping).toBeGreaterThanOrEqual(3);

    // ...and from Mozaik's own inference events, persisted by the trace observer
    const ev = await events(caseId, run.id);
    const spans = new Map<string, { s?: number; e?: number }>();
    for (const e of ev) {
      const loop = e.payload.loopId as string | undefined;
      if (!loop) continue;
      const cur = spans.get(loop) ?? {};
      if (e.type === 'mozaik.inference.started') cur.s = ms(e.occurredAt);
      if (e.type === 'mozaik.inference.completed') cur.e = ms(e.occurredAt);
      spans.set(loop, cur);
    }
    const done = [...spans.values()].filter((x) => x.s && x.e);
    expect(done.length).toBeGreaterThanOrEqual(4);
    let inferenceOverlap = 0;
    for (let i = 0; i < done.length; i++) for (let j = i + 1; j < done.length; j++) if (Math.min(done[i].e!, done[j].e!) > Math.max(done[i].s!, done[j].s!)) inferenceOverlap++;
    expect(inferenceOverlap).toBeGreaterThanOrEqual(2);

    // exactly one case.started, produced once
    expect(ev.filter((e) => e.type === 'case.started')).toHaveLength(1);
  });

  it('reports a provisional comparison from the invoice and packing list only', async () => {
    const s = await snapshot(caseId);
    const a = (await latestAssessment(caseId))!;
    expect(a.version).toBe(1);
    expect(a.classification).toBe('declared_volume_conflicts_with_bill');
    const diff = s.calcs.find((c) => c.topic === 'billed_vs_declared:charge_difference' && c.status === 'current')!;
    expect(diff.output).toBe('298100');
    // billing first reported missing inputs (it did not wait for the Evidence Agent), later resolved
    const missing = s.findings.filter((f) => f.topic.startsWith('missing:'));
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((f) => f.status === 'superseded')).toBe(true);
    expect(s.agentRuns.filter((x) => x.agentRole === 'billing').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every fact tied to a real span and quote', async () => {
    const s = await snapshot(caseId);
    const spans = new Set((await listSpans(caseId)).map((x) => x.ref));
    for (const f of s.facts.filter((x) => x.provenance !== 'calculation')) {
      expect(f.spanRefs.length).toBeGreaterThan(0);
      for (const r of f.spanRefs) expect(spans.has(r)).toBe(true);
    }
  });
});

describe('new evidence changes the case, the letter and says why', () => {
  it('survey evidence: comparison, finding and letter are revised; the old reading is superseded', async () => {
    const before = await listDrafts(caseId);
    await addDemoEvidence(caseId, 'survey');
    const run = await latestRun(caseId);
    expect(run.kind).toBe('reassess');
    const r = await runQueued(run.id);
    expect(r.code).toBe(0);

    const s = await snapshot(caseId);
    const a = (await latestAssessment(caseId))!;
    expect(a.version).toBe(2);
    expect(a.classification).toBe('measured_volume_differs_basis_unresolved');
    expect(a.changeReason).toMatch(/changed the reading/);
    expect(a.headline).toContain('₦189,700');

    expect(s.calcs.find((c) => c.topic === 'billed_vs_measured:billed_charge' && c.status === 'current')!.output).toBe('596200');
    expect(s.calcs.find((c) => c.topic === 'billed_vs_measured:comparison_charge' && c.status === 'current')!.output).toBe('406500');
    expect(s.calcs.find((c) => c.topic === 'billed_vs_measured:charge_difference' && c.status === 'current')!.output).toBe('189700');
    // six published package dimensions sum to 0.757348 CBM, kept distinct from the 0.75 reported
    expect(s.calcs.find((c) => c.kind === 'package_sum' && c.status === 'current')!.output).toBe('0.757348');

    const overall = s.findings.filter((f) => f.topic === 'interpretation:overall');
    expect(overall).toHaveLength(2);
    const old = overall.find((f) => f.status === 'superseded')!;
    const cur = overall.find((f) => f.status !== 'superseded')!;
    expect(old.supersededByRef).toBe(cur.ref);
    expect(cur.supersedesRef).toBe(old.ref);

    const draft = (await currentDraft(caseId))!;
    expect(draft.version).toBeGreaterThan(before[0].version);
    expect(letterText(draft)).toContain('₦189,700');
    expect(draft.changeSummary).toBeTruthy();
    expect((await listDrafts(caseId)).some((d) => d.status === 'superseded')).toBe(true);

    // the trigger chain is recorded: evidence.added -> fact.recorded -> calculation.completed -> assessment.updated -> draft.updated
    const ev = await events(caseId, run.id);
    const order = ev.map((e) => e.type);
    for (const t of ['evidence.added', 'fact.recorded', 'calculation.completed', 'assessment.updated', 'draft.updated']) expect(order).toContain(t);
    expect(order.indexOf('evidence.added')).toBeLessThan(order.indexOf('calculation.completed'));
    expect(order.indexOf('calculation.completed')).toBeLessThan(order.indexOf('assessment.updated'));
    expect(order.indexOf('assessment.updated')).toBeLessThan(order.indexOf('draft.updated'));
    expect(ev.filter((e) => e.type === 'case.started')).toHaveLength(0); // a reassessment is not a restart
  });

  it('re-adding evidence that is already recorded creates no duplicate facts, findings or drafts', async () => {
    const before = await snapshot(caseId);
    const draftsBefore = (await listDrafts(caseId)).length;
    const assessmentsBefore = (await listAssessments(caseId)).length;
    const surveyDoc = before.facts.find((f) => f.key === 'measured_volume_cbm')!.spanRefs[0].split('-')[0];
    const { requestReassess } = await import('@/server/runs');
    const run = (await requestReassess(caseId, { reason: 'Duplicate delivery of the same evidence', documentRefs: [surveyDoc] }))!;
    await runQueued(run.id);
    const after = await snapshot(caseId);
    expect(after.facts.length).toBe(before.facts.length);
    expect(after.findings.length).toBe(before.findings.length);
    expect(after.calcs.length).toBe(before.calcs.length);
    expect((await listDrafts(caseId)).length).toBe(draftsBefore);
    expect((await listAssessments(caseId)).length).toBe(assessmentsBefore);
  });

  it('wakes only the affected agents for a small change (a packing-list correction does not wake Contract or Timeline)', async () => {
    await addText(caseId, 'Packing list v2.txt', 'PACKING LIST (second copy)\nEstimated total volume: 0.55 CBM\n', 'packing_list');
    const { requestReassess } = await import('@/server/runs');
    const doc = (await import('@/db/repo')).listDocuments;
    const last = (await doc(caseId)).at(-1)!;
    const run = (await requestReassess(caseId, { reason: `New evidence ${last.ref}`, documentRefs: [last.ref] }))!;
    await runQueued(run.id);
    const s = await snapshot(caseId);
    const roles = new Set(s.agentRuns.filter((a) => a.runId === run.id).map((a) => a.agentRole));
    expect(roles.has('evidence')).toBe(true);
    expect(roles.has('contract')).toBe(false);
    expect(roles.has('timeline')).toBe(false);
  });

  it('a stated contractual minimum downgrades the overcharge reading and changes the letter', async () => {
    await addDemoEvidence(caseId, 'rate-sheet');
    const run = await latestRun(caseId);
    await runQueued(run.id);
    const s = await snapshot(caseId);
    const a = (await latestAssessment(caseId))!;
    expect(a.classification).toBe('contract_term_may_explain_bill');
    expect(a.headline).toContain('₦54,200');
    // 1.10 billed vs max(0.75, 1.00 minimum) = 1.00 chargeable: 0.10 CBM x 542,000 remains unexplained
    expect(s.calcs.find((c) => c.topic === 'billed_vs_contract_term:chargeable_volume' && c.status === 'current')!.output).toBe('1');
    expect(s.calcs.find((c) => c.topic === 'billed_vs_contract_term:charge_difference' && c.status === 'current')!.output).toBe('54200');
    const interp = (await import('@/db/repo')).currentInterpretation;
    expect((await interp(caseId))!.termsStatus).toBe('terms_found');
    const draft = (await currentDraft(caseId))!;
    expect(letterText(draft)).toContain('minimum');
    expect(forbiddenLanguage(letterText(draft))).toEqual([]);
    // the earlier unsupported "overcharge" reading survives only as superseded history
    expect(s.findings.filter((f) => f.topic === 'interpretation:overall' && f.status === 'superseded').length).toBeGreaterThanOrEqual(2);
  });

  it('a user correction keeps the original, records provenance, reassesses and updates the numbers', async () => {
    const s0 = await snapshot(caseId);
    const measured = s0.facts.find((f) => f.key === 'measured_volume_cbm' && f.status === 'active')!;
    const c0 = await (await import('@/db/repo')).getCase(caseId);
    await expect(correctFact(caseId, measured.ref, { value: '0.80', note: 'Surveyor re-weighed', expectedRevision: c0!.revision - 1 })).rejects.toMatchObject({ code: 'revision_conflict' });
    const { fact, reassessQueued } = await correctFact(caseId, measured.ref, { value: '0.80', note: 'Surveyor re-weighed', expectedRevision: c0!.revision });
    expect(reassessQueued).toBe(true);
    expect(fact.provenance).toBe('user_correction');
    expect(fact.correctsRef).toBe(measured.ref);
    const run = await latestRun(caseId);
    await runQueued(run.id);
    const s = await snapshot(caseId);
    expect(s.facts.find((f) => f.ref === measured.ref)!.status).toBe('superseded');
    expect(s.facts.find((f) => f.ref === measured.ref)!.value).toBe('0.75'); // original preserved
    // 1.10 - 0.80 = 0.30 CBM x 542,000
    expect(s.calcs.find((c) => c.topic === 'billed_vs_measured:charge_difference' && c.status === 'current')!.output).toBe('162600');
  });
});

describe('exports', () => {
  it('produces readable PDFs that carry the amounts and the reconstruction disclosures', async () => {
    const built = await buildExports(caseId);
    const complaint = built.items.find((i) => i.kind === 'complaint_pdf')!;
    const summary = built.items.find((i) => i.kind === 'evidence_summary_pdf')!;
    expect(Buffer.from(complaint.bytes).subarray(0, 5).toString()).toBe('%PDF-');
    const t1 = await pdfText(complaint.bytes as Uint8Array);
    const t2 = await pdfText(summary.bytes as Uint8Array);
    expect(t1).toContain('₦');
    expect(t1).toMatch(/Reconstructed for demonstration|reconstructed for demonstration/);
    expect(t1).toContain('Prepared with Counterbill; reviewed by sender');
    expect(t2).toContain('Evidence summary');
    expect(t2).toContain('not automatically a recoverable overcharge');
    expect(t2).toContain('TEST MODE');
    expect(t2).toContain('0.757348');
    expect(t2).toMatch(/Earlier readings \(superseded\)/);
    expect(complaint.filename).toMatch(/Complaint-v\d+\.pdf$/);
  });
});
