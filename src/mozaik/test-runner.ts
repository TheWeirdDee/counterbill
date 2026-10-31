/**
 * TEST MODE ONLY. A deterministic stand-in for the language model, used by CI and offline checks
 * (COUNTERBILL_INFERENCE=test). It is plugged into the real Mozaik runtime as the InferenceRunner, so agents,
 * events, handlers, validation and persistence all run for real; only the model call is scripted.
 *
 * It reads the same prompts the real model would, applies fixed patterns for the demonstration documents, and
 * returns schema-shaped JSON. It is never selected implicitly, runs are labelled "TEST MODE" in the UI and in the
 * trace, and nothing it produces may be described as live AI.
 */
import { ModelMessageItem, UserMessageItem, type InferenceInput, type InferenceOutput, type InferenceRunner, type SemanticEvent } from '@mozaik-ai/core';

const DELAY: Record<string, number> = { evidence_output: 1500, billing_output: 1100, contract_output: 1700, timeline_output: 1300, case_output: 1400, draft_output: 1200 };
const faultCounts = new Map<string, number>();

function faults(): string[] {
  return (process.env.COUNTERBILL_TEST_FAULTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

export class ScriptedInferenceRunner implements InferenceRunner {
  async run(request: InferenceInput): Promise<InferenceOutput> {
    const name = request.structuredOutput?.name ?? '';
    const user = lastUserText(request);
    const baseDelay = Number(process.env.COUNTERBILL_TEST_DELAY_MS ?? '') || DELAY[name] || 1000;
    const extra = faults().find((f) => f.startsWith(`delay:${name}:`));
    await sleep(extra ? Number(extra.split(':')[2]) : baseDelay);

    const role = name.replace(/_output$/, '');
    for (const f of faults()) {
      if (f === `fail:${role}`) throw Object.assign(new Error('Injected provider failure'), { status: 503 });
      if (f === `malformed_once:${role}`) {
        const n = (faultCounts.get(f) ?? 0) + 1;
        faultCounts.set(f, n);
        if (n === 1) return answer('{"facts": [ not json');
      }
      if (f === `obey_injection_once:${role}`) {
        const n = (faultCounts.get(f) ?? 0) + 1;
        faultCounts.set(f, n);
        if (n === 1) return answer(JSON.stringify(script(name, user, { obeyInjection: true })));
      }
      if (f === `badcitation_once:${role}`) {
        const n = (faultCounts.get(f) ?? 0) + 1;
        faultCounts.set(f, n);
        if (n === 1) return answer(JSON.stringify(script(name, user, { badCitation: true })));
      }
    }
    return answer(JSON.stringify(script(name, user, {})));
  }
  async *stream(): AsyncGenerator<SemanticEvent> {
    throw new Error('The test runner does not stream.');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function answer(text: string): InferenceOutput {
  return { items: [ModelMessageItem.rehydrate({ text })], tokenUsage: undefined, rowResponse: null };
}
function lastUserText(req: InferenceInput): string {
  const items = req.context.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it instanceof UserMessageItem) return it.content.text;
  }
  return '';
}

// ------------------------------------------------------------------ prompt parsing

interface Span {
  ref: string;
  text: string;
  lines: string[];
}
interface Doc {
  ref: string;
  kind: string;
  spans: Span[];
}
interface Fact {
  ref: string;
  key: string;
  subject: string | null;
  value: string;
  unit: string | null;
  provenance: string;
}

function parseDocs(msg: string): Doc[] {
  const docs: Doc[] = [];
  for (const m of msg.matchAll(/<document ref="(D\d+)" kind="([^"]+)"[^>]*>\n([\s\S]*?)\n<\/document>/g)) {
    const spans: Span[] = [];
    let cur: Span | null = null;
    for (const line of m[3].split('\n')) {
      const h = line.match(/^\[(D\d+-p\d+-s\d+)\] ?(.*)$/);
      if (h) {
        cur = { ref: h[1], text: h[2], lines: [h[2].trim()] };
        spans.push(cur);
      } else if (cur && /^ {4}/.test(line)) {
        cur.text += `\n${line.trim()}`;
        cur.lines.push(line.trim());
      }
    }
    docs.push({ ref: m[1], kind: m[2], spans });
  }
  return docs;
}

function parseFacts(msg: string): Fact[] {
  const out: Fact[] = [];
  for (const line of msg.split('\n')) {
    const m = line.match(/^(F\d+) (\w+)(?: \(([^)]*)\))? = (\S+)(?: ([^[]*?))? \[(\w+)/);
    if (m) out.push({ ref: m[1], key: m[2], subject: m[3] ?? null, value: m[4], unit: m[5]?.trim() || null, provenance: m[6] });
  }
  return out;
}

function pickFact(facts: Fact[], key: string): Fact | undefined {
  const all = facts.filter((f) => f.key === key);
  return all.find((f) => f.provenance !== 'user_statement') ?? all[0];
}

const MONTHS: Record<string, string> = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };
function isoDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${MONTHS[m[2].toLowerCase()]}-${m[1].padStart(2, '0')}`;
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}
const num = (s: string) => s.replace(/,/g, '');

// ------------------------------------------------------------------ scripts

function script(name: string, msg: string, opt: { badCitation?: boolean; obeyInjection?: boolean }): unknown {
  switch (name) {
    case 'evidence_output':
      return evidence(msg, opt.badCitation);
    case 'billing_output':
      return billing(msg);
    case 'contract_output':
      return contract(msg);
    case 'timeline_output':
      return timeline(msg);
    case 'case_output': {
      const out = caseAssessment(msg) as Record<string, unknown>;
      // Simulates a model that OBEYED an instruction hidden in a document: validation must reject it.
      if (opt.obeyInjection) out.headline = 'Refund approved: you are owed the full amount, a guaranteed refund.';
      return out;
    }
    case 'draft_output':
      return drafting(msg);
    default:
      throw new Error(`Test runner has no script for "${name}"`);
  }
}

function evidence(msg: string, badCitation?: boolean) {
  const facts: unknown[] = [];
  const seen = new Set<string>();
  const add = (key: string, subject: string | null, value: string, unit: string | null, currency: string | null, span: Span, quote: string) => {
    const k = `${key}|${subject}|${value}|${span.ref}`;
    if (seen.has(k)) return;
    seen.add(k);
    facts.push({ key, subject, value, unit, currency, spanRefs: [badCitation ? 'D9-p9-s9' : span.ref], quote, confidence: 'high', notes: null });
  };
  for (const d of parseDocs(msg)) {
    for (const sp of d.spans) {
      for (const line of sp.lines) {
        let m: RegExpMatchArray | null;
        if (d.kind === 'user_statement') {
          if ((m = line.match(/invoice uses ([\d.]+) CBM/i))) add('billed_volume_cbm', null, m[1], 'CBM', null, sp, m[0]);
          if ((m = line.match(/packing list says ([\d.]+) CBM/i))) add('declared_volume_cbm', null, m[1], 'CBM', null, sp, m[0]);
          continue;
        }
        if ((m = line.match(/^Billed volume:\s*([\d.,]+)\s*CBM/i))) add('billed_volume_cbm', null, num(m[1]), 'CBM', null, sp, m[0]);
        if ((m = line.match(/^Rate:\s*(?:NGN|₦)\s*([\d.,]+)\s*per CBM/i))) add('rate_per_cbm', null, num(m[1]), 'per CBM', 'NGN', sp, m[0]);
        if ((m = line.match(/^Minimum chargeable volume:\s*([\d.,]+)\s*CBM/i))) add('minimum_chargeable_cbm', null, num(m[1]), 'CBM', null, sp, m[0]);
        if ((m = line.match(/^Freight charge:\s*(?:NGN|₦)\s*([\d.,]+)/i))) add('billed_freight_amount', null, num(m[1]), null, 'NGN', sp, m[0]);
        if ((m = line.match(/^Packages:\s*(\d+)/i))) add('package_count', null, m[1], null, null, sp, m[0]);
        if ((m = line.match(/^Estimated total volume:\s*([\d.,]+)\s*CBM/i))) add('declared_volume_cbm', null, num(m[1]), 'CBM', null, sp, m[0]);
        if ((m = line.match(/^Reported surveyed volume:\s*([\d.,]+)\s*CBM/i))) add('measured_volume_cbm', null, num(m[1]), 'CBM', null, sp, m[0]);
        if ((m = line.match(/^Box (\d+):\s*([\d.]+)\s*[x×]\s*([\d.]+)\s*[x×]\s*([\d.]+)/i))) add('package_dimensions_cm', `Box ${m[1]}`, `${m[2]}x${m[3]}x${m[4]}`, 'cm', null, sp, m[0]);
        if ((m = line.match(/^Survey date:\s*(.+)$/i))) add('survey_date', null, m[1].trim(), null, null, sp, m[0]);
        if ((m = line.match(/^Invoice date:\s*(?!not )(.+)$/i))) add('invoice_date', null, m[1].trim(), null, null, sp, m[0]);
        if ((m = line.match(/^Charges faced by the importer in total:\s*(?:NGN|₦)\s*([\d,]+)/i))) add('invoice_total_amount', null, num(m[1]), null, 'NGN', sp, m[0]);
        if ((m = line.match(/^Consignment: approximately ([\d.]+) CBM/i))) add('declared_volume_cbm', null, m[1], 'CBM', null, sp, m[0]);
      }
    }
  }
  return { facts, ambiguities: [], questions: [] };
}

function billing(msg: string) {
  const facts = parseFacts(msg);
  const billed = pickFact(facts, 'billed_volume_cbm');
  const declared = pickFact(facts, 'declared_volume_cbm');
  const measured = pickFact(facts, 'measured_volume_cbm');
  const rate = pickFact(facts, 'rate_per_cbm');
  const min = pickFact(facts, 'minimum_chargeable_cbm');
  const packages = facts.filter((f) => f.key === 'package_dimensions_cm');
  const comparisons: unknown[] = [];
  const base = (topic: string, label: string, cmp: Fact | null, withMin: boolean) => ({
    topic, label, billedVolumeFact: billed!.ref, comparisonVolumeFact: cmp!.ref, rateFact: rate!.ref, contractMinimumFact: withMin ? min!.ref : null, note: null,
  });
  if (billed && rate && declared) comparisons.push(base('billed_vs_declared', 'Billed volume against the packing-list estimate', declared, false));
  if (billed && rate && measured) comparisons.push(base('billed_vs_measured', 'Billed volume against the surveyed volume', measured, false));
  if (billed && rate && measured && min) comparisons.push(base('billed_vs_contract_term', 'Surveyed volume under the stated contract minimum', measured, true));
  const missing: { variable: string; reason: string }[] = [];
  if (!rate) missing.push({ variable: 'Rate per CBM', reason: 'No document records the rate applied per CBM.' });
  if (!billed) missing.push({ variable: 'Billed volume', reason: 'No document states the volume that was billed.' });
  if (billed && rate && !declared && !measured) missing.push({ variable: 'A volume to compare with the bill', reason: 'There is no packing-list estimate or measurement to compare the billed volume with.' });
  return {
    comparisons,
    packageSums: packages.length ? [{ label: 'Sum of the surveyed package dimensions', packageFactRefs: packages.map((p) => p.ref), reportedVolumeFact: measured?.ref ?? null }] : [],
    missingVariables: missing,
    summary: comparisons.length ? 'Requested the comparisons the recorded facts support.' : 'The recorded facts do not yet support a comparison.',
  };
}

function contract(msg: string) {
  const clauses: unknown[] = [];
  const challenges: unknown[] = [];
  for (const d of parseDocs(msg)) {
    for (const sp of d.spans) {
      for (const line of sp.lines) {
        const m = line.match(/^Minimum chargeable volume:\s*([\d.,]+)\s*CBM[^\n]*/i);
        if (m) clauses.push({ kind: 'minimum_chargeable_volume', quote: m[0], spanRefs: [sp.ref], minimumCbm: num(m[1]), roundUpToCbm: null, rate: null, currency: null, interpretation: 'States a minimum chargeable volume per shipment.' });
        if (/did not determine the rating methodology/i.test(line)) {
          challenges.push({ targetTopic: 'interpretation:chargeable_volume_basis', reason: 'The cited report states the rating methodology was not determined.', spanRefs: [sp.ref] });
        }
      }
    }
  }
  const found = clauses.length > 0;
  return {
    termsStatus: found ? 'terms_found' : 'terms_missing',
    clauses,
    carrierQuestions: found ? [] : [{ audience: 'carrier', prompt: 'Which contract clause or rate sheet supports the chargeable volume shown on the invoice?', reason: 'No document in the case states how chargeable volume is determined.' }],
    challenges,
    summary: found ? 'A stated minimum chargeable volume is present in the documents.' : 'No document states how chargeable volume is determined.',
  };
}

function timeline(msg: string) {
  const events: unknown[] = [];
  const seen = new Set<string>();
  for (const d of parseDocs(msg)) {
    for (const sp of d.spans) {
      for (const line of sp.lines) {
        let m: RegExpMatchArray | null;
        const push = (date: string | null, actor: string | null, description: string) => {
          const k = `${date}|${description}`;
          if (seen.has(k)) return;
          seen.add(k);
          events.push({ date, datePrecision: date ? 'day' : 'unknown', actor, description, spanRefs: [sp.ref] });
        };
        if ((m = line.match(/^Complaint filed online with NPERA:\s*(.+)$/i))) push(isoDate(m[1]), 'Complainant', 'Complaint filed online with NPERA.');
        if ((m = line.match(/^Survey date:\s*(.+)$/i))) push(isoDate(m[1]), 'Independent surveyor', 'Joint survey of the six packages.');
        if ((m = line.match(/^Tripartite resolution meeting held:\s*(.+)$/i))) push(isoDate(m[1]), 'Nigerian Shippers\' Council', 'Tripartite resolution meeting held.');
        if (/paid the invoice under protest/i.test(line)) push(null, 'Complainant', 'Invoice paid under protest to secure release of the cargo (payment date not stated).');
        if ((m = line.match(/^Invoice date:\s*(?!not )(.+)$/i))) push(isoDate(m[1]), null, 'Invoice issued.');
      }
    }
  }
  return { events, gaps: events.length ? ['The date the invoice was issued is not stated in the documents.'] : ['No dated events are stated in the documents.'], conflicts: [], summary: `Recorded ${events.length} dated or undated events from the documents.` };
}

// ---- case + drafting rely on the structured sections that prompts.ts renders

interface CalcL {
  ref: string;
  topic: string;
  label: string;
  formula: string;
  display: string;
}
function parseCalcs(msg: string): CalcL[] {
  const out: CalcL[] = [];
  for (const line of msg.split('\n')) {
    const m = line.match(/^(C\d+) \[([^\]]+)\] ([^:]+): (.*)$/);
    if (m) out.push({ ref: m[1], topic: m[2], label: m[3], formula: m[4], display: (m[4].split('=').pop() ?? '').trim() });
  }
  return out;
}
interface FindL {
  ref: string;
  topic: string;
  status: string;
}
function parseFindings(msg: string): FindL[] {
  const out: FindL[] = [];
  for (const line of msg.split('\n')) {
    const m = line.match(/^(FN\d+) \[(\w+)\/[^\]]*\] topic=([^:]+(?::[^:]+)?):/);
    if (m) out.push({ ref: m[1], topic: m[3], status: m[2] });
  }
  return out;
}

function classify(msg: string): { cls: string; calcs: CalcL[]; facts: Fact[] } {
  const calcs = parseCalcs(msg);
  const facts = parseFacts(msg);
  const hasContract = /Contract interpretation: I\d+ terms_found/.test(msg);
  const has = (t: string) => calcs.some((c) => c.topic.startsWith(t));
  const cls = hasContract && has('billed_vs_contract_term') ? 'contract_term_may_explain_bill' : has('billed_vs_measured') ? 'measured_volume_differs_basis_unresolved' : has('billed_vs_declared') ? 'declared_volume_conflicts_with_bill' : 'insufficient_evidence';
  return { cls, calcs, facts };
}

const CLASS_LABEL: Record<string, string> = {
  insufficient_evidence: 'not enough evidence yet',
  declared_volume_conflicts_with_bill: 'the packing-list estimate conflicts with the bill',
  measured_volume_differs_basis_unresolved: 'a measurement supports a volume difference but the rating basis is unresolved',
  contract_term_may_explain_bill: 'a stated contract term may explain the billed volume',
};

function caseAssessment(msg: string) {
  const { cls, calcs, facts } = classify(msg);
  const finds = parseFindings(msg);
  const disp = (topic: string, kind: string) => calcs.find((c) => c.topic === `${topic}:${kind}`)?.display;
  const refs = (topic: string) => calcs.filter((c) => c.topic.startsWith(`${topic}:`)).map((c) => c.ref);
  const prev = msg.match(/Previous assessment: v(\d+) (\w+) —/);
  let headline: string;
  let summary: string;
  let calcRefs: string[];
  let factRefs: string[];
  let status: 'provisional' | 'disputed' = 'provisional';
  const min = facts.find((f) => f.key === 'minimum_chargeable_cbm');
  switch (cls) {
    case 'declared_volume_conflicts_with_bill':
      headline = 'The packing-list estimate conflicts with the billed volume; there is no independent measurement or contract term yet.';
      summary = `Comparing the invoice with the packing-list estimate gives a ${disp('billed_vs_declared', 'charge_difference')} comparison. A packing-list estimate is not a measurement, so this does not show the bill is wrong.`;
      calcRefs = refs('billed_vs_declared');
      factRefs = facts.filter((f) => ['billed_volume_cbm', 'declared_volume_cbm', 'rate_per_cbm'].includes(f.key)).map((f) => f.ref);
      break;
    case 'measured_volume_differs_basis_unresolved':
      headline = `A survey supports a ${disp('billed_vs_measured', 'volume_difference')} volume difference (${disp('billed_vs_measured', 'charge_difference')} at the billed rate); the contractual rating basis is unresolved.`;
      summary = `The surveyed volume is below the billed volume, a ${disp('billed_vs_measured', 'charge_difference')} difference under review. No document states how chargeable volume is determined, so the difference is a comparison, not an established overcharge or refund.`;
      calcRefs = refs('billed_vs_measured');
      factRefs = facts.filter((f) => ['billed_volume_cbm', 'measured_volume_cbm', 'rate_per_cbm'].includes(f.key)).map((f) => f.ref);
      break;
    case 'contract_term_may_explain_bill':
      headline = `A stated minimum of ${min ? Number(min.value).toFixed(2) : ''} CBM may explain most of the billed volume; ${disp('billed_vs_contract_term', 'charge_difference')} remains unexplained.`;
      summary = `Under the minimum chargeable volume quoted in the document, the chargeable volume is higher than the measured volume, so the earlier reading that the whole difference is unexplained no longer holds. ${disp('billed_vs_contract_term', 'charge_difference')} is still not explained by that term, and whether the term applies to this shipment needs confirming.`;
      calcRefs = refs('billed_vs_contract_term');
      factRefs = facts.filter((f) => ['billed_volume_cbm', 'measured_volume_cbm', 'minimum_chargeable_cbm', 'rate_per_cbm'].includes(f.key)).map((f) => f.ref);
      status = 'disputed';
      break;
    default:
      headline = 'There is not yet enough evidence to compare the bill with other records.';
      summary = 'The recorded facts do not yet support a numerical comparison.';
      calcRefs = [];
      factRefs = facts.slice(0, 3).map((f) => f.ref);
  }
  const findings = factRefs.length || calcRefs.length
    ? [{
        topic: 'interpretation:overall', title: headline.slice(0, 190), category: cls === 'contract_term_may_explain_bill' ? 'competing_explanation' : 'supported_discrepancy',
        severity: cls === 'insufficient_evidence' ? 'informational' : 'material', status, explanation: summary.slice(0, 1100), factRefs, calcRefs, spanRefs: [], basis: 'sourced',
      }]
    : [];
  const measuredFinding = finds.find((f) => f.topic === 'volume:billed_vs_measured' && f.status === 'provisional');
  const ops = measuredFinding && cls !== 'insufficient_evidence' ? [{ ref: measuredFinding.ref, action: 'confirm', reason: 'The arithmetic is backed by a cited measurement and rate.' }] : [];
  const hasTerms = /Contract interpretation: I\d+ terms_found/.test(msg);
  return {
    classification: cls,
    headline,
    summary,
    strongestCounterExplanation: hasTerms
      ? 'The freight company may rate chargeable volume under the stated minimum, which can exceed the physical volume.'
      : 'The freight company may rate chargeable volume on a basis (such as a minimum, rounding or packing allowance) that is not in the documents provided.',
    changeReason: prev ? `New evidence changed the reading from "${CLASS_LABEL[prev[2]] ?? prev[2]}" to "${CLASS_LABEL[cls]}" (see ${calcRefs.slice(0, 4).join(', ') || 'the updated facts'}).` : null,
    findings,
    findingOps: ops,
    resolvedQuestionRefs: [],
    questions: [
      ...(hasTerms ? [] : [{ audience: 'user', prompt: 'Do you have the quote or rate sheet that shows how chargeable volume is calculated?', reason: 'No document states the rating basis.' }]),
      { audience: 'carrier', prompt: 'Which contract clause or rate sheet supports the chargeable volume shown on the invoice?', reason: 'The basis for the billed volume is not documented.' },
    ],
    nextAction: hasTerms ? 'Ask the freight company whether the stated minimum applies and what explains the remaining volume.' : 'Ask the freight company for its rated-volume calculation and the applicable rate sheet.',
    readiness: calcRefs.length ? 'review_ready' : 'needs_input',
  };
}

function drafting(msg: string) {
  const { cls: inferred, calcs } = classify(msg);
  // The drafting prompt states the current assessment classification; follow it like a model would.
  const cls = msg.match(/Assessment v\d+: (\w+) —/)?.[1] ?? inferred;
  const finds = parseFindings(msg).filter((f) => f.status !== 'superseded');
  const topics = ['billed_vs_declared', 'billed_vs_measured', 'billed_vs_contract_term'].filter((t) => calcs.some((c) => c.topic.startsWith(`${t}:`)));
  const refs = [...finds.map((f) => f.ref), ...calcs.map((c) => c.ref)].slice(0, 12);
  const f = (t: string, k: string) => calcs.find((c) => c.topic === `${t}:${k}`)?.formula;
  const lines: string[] = [];
  if (topics.length) lines.push(`Billed charge: ${f(topics[0], 'billed_charge')}.`);
  for (const t of topics) {
    const label = t === 'billed_vs_declared' ? 'At the packing-list estimate' : t === 'billed_vs_measured' ? 'At the surveyed volume' : 'Under the stated minimum chargeable volume';
    lines.push(`${label}: ${f(t, 'comparison_charge')}. Difference: ${f(t, 'charge_difference')}.`);
  }
  lines.push('These figures compare charges under stated assumptions. They are not a claim of an amount owed.');
  const uncertainty =
    cls === 'contract_term_may_explain_bill'
      ? 'A document we hold states a minimum chargeable volume, which may account for part of the billed volume. We would like to confirm whether that term applies to this shipment and how the remaining difference arises.'
      : 'We do not hold the contract term, rate sheet or calculation that sets the chargeable volume, so we cannot say whether the billed volume follows the agreed rating basis. A measurement of physical volume does not by itself decide the chargeable volume.';
  return {
    sections: [
      { id: 'concern', text: 'We are writing to ask for clarification of how the volume used to calculate the freight charge on this shipment was determined. We compared the invoice with the other records we hold and found differences we would like to understand.', refs },
      { id: 'comparison', text: lines.join('\n'), refs },
      { id: 'uncertainty', text: uncertainty, refs },
      { id: 'requests', text: 'Please provide: (1) the calculation of the chargeable volume used on the invoice; (2) the rate sheet or terms that apply to this shipment; (3) an explanation of any difference between the billed volume and the measured volume; and (4) a proposed adjustment if the review shows one is warranted.', refs },
    ],
    changeSummary: `Letter written from the current assessment (${CLASS_LABEL[cls] ?? cls}).`,
  };
}

/** The scripted answer for a structured-output name. Shared by the in-process runner and the protocol-level fake provider used in tests. */
export function scriptedAnswer(structuredOutputName: string, userText: string): unknown {
  return script(structuredOutputName, userText, {});
}
