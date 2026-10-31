/**
 * Billing Agent: chooses which comparisons the recorded facts support. Deterministic code computes every figure
 * (domain/case-rules.ts) and writes the calculations and the numerical findings; the model never states a number.
 */
import { createAgent } from '@mozaik-ai/core';
import { query } from '@/db/pool';
import { applyFinding, currentInterpretation, listCalculations, listFacts, upsertCalculation, type FactRow, type FindingRow } from '@/db/repo';
import { CalculationError, formatCbm, formatMoney } from '@/domain/calculations';
import {
  allowedFigures,
  computeComparison,
  computePackageSum,
  contentHash,
  forbiddenLanguage,
  unsupportedFigures,
  type ComparisonResult,
  type FactLite,
} from '@/domain/case-rules';
import { BillingOutput } from '@/domain/schemas';
import { emit } from '../events';
import { loopHandlers, reactTo } from '../handlers';
import { billingMessage, INSTRUCTIONS } from '../prompts';
import { state } from '../runtime';
import { runAgentTask } from '../tasks';
import { calculateCbmTool, calculateChargeTool } from '../tools';
import { finish } from './common';

const BILLING_KEYS =
  /^(billed_volume_cbm|declared_volume_cbm|measured_volume_cbm|chargeable_volume_cbm|rate_per_cbm|minimum_chargeable_cbm|package_dimensions_cm|billed_freight_amount|invoice_total_amount)$/;

export function createBillingAgent() {
  return createAgent({
    name: 'Billing Agent',
    capabilities: ['inference'],
    instruction: INSTRUCTIONS.billing,
    tools: [calculateCbmTool, calculateChargeTool],
    handlers: [
      ...loopHandlers(),
      reactTo('billing', ['case.started'], async (_e, p) => {
        const s = state();
        if (s.targeted.length && !s.targeted.includes('billing')) return;
        await runBilling('Review the billing variables available at the start of the investigation.', p.eventId);
      }),
      reactTo(
        'billing',
        ['fact.recorded', 'fact.corrected'],
        async (_e, p) => {
          await runBilling(`New or corrected facts were recorded (${(p.keys as string[] | undefined)?.join(', ') ?? String(p.key)}).`, p.eventId);
        },
        (e) => {
          const p = e.payload as { keys?: string[]; key?: string };
          return (p.keys ?? [p.key ?? '']).some((k) => BILLING_KEYS.test(k));
        },
      ),
      reactTo(
        'billing',
        ['contract.interpretation'],
        async (_e, p) => {
          await runBilling('The Contract Agent reported contract terms that may change the chargeable volume.', p.eventId);
        },
        (e) => (e.payload as { affectsCalculation?: boolean }).affectsCalculation === true,
      ),
    ],
  });
}

const lite = (f: FactRow): FactLite => ({ ref: f.ref, key: f.key, subject: f.subject, value: f.value, unit: f.unit, currency: f.currency, status: f.status });

async function signature(caseId: string): Promise<string> {
  const facts = (await listFacts(caseId)).filter((f) => BILLING_KEYS.test(f.key));
  const interp = await currentInterpretation(caseId);
  return contentHash({ f: facts.map((f) => [f.ref, f.value, f.status]), i: interp?.ref ?? null });
}

async function runBilling(reason: string, triggerEventId: string) {
  const s = state();
  const sig = await signature(s.caseId);
  if (s.inputSignature.get('billing') === sig) return; // nothing relevant changed since the last pass
  await runAgentTask({
    role: 'billing',
    label: reason.slice(0, 80),
    triggerEventId,
    schema: BillingOutput,
    schemaName: 'billing_output',
    tools: [calculateCbmTool, calculateChargeTool],
    buildMessage: (fb) => billingMessage(s.caseId, reason, fb),
    async commit(out, { db, revision, runId, caseId }) {
      const problems: string[] = [];
      const facts = new Map((await listFacts(caseId, {}, db)).map((f) => [f.ref, f]));
      const get = (ref: string | null, keys: RegExp, where: string): FactRow | null => {
        if (!ref) return null;
        const f = facts.get(ref);
        if (!f) problems.push(`${where}: ${ref} is not an active recorded fact`);
        else if (!keys.test(f.key)) problems.push(`${where}: ${ref} is a "${f.key}" fact, which cannot be used here`);
        return f ?? null;
      };

      const results: { r: ComparisonResult; facts: FactRow[]; note: string | null }[] = [];
      out.comparisons.forEach((c, i) => {
        const where = `comparisons[${i}] (${c.topic})`;
        const billed = get(c.billedVolumeFact, /^(billed_volume_cbm|chargeable_volume_cbm)$/, `${where}.billedVolumeFact`);
        const comp = get(c.comparisonVolumeFact, c.topic === 'billed_vs_declared' ? /^declared_volume_cbm$/ : /^measured_volume_cbm$/, `${where}.comparisonVolumeFact`);
        const rate = get(c.rateFact, /^rate_per_cbm$/, `${where}.rateFact`);
        const min = c.topic === 'billed_vs_contract_term' ? get(c.contractMinimumFact, /^minimum_chargeable_cbm$/, `${where}.contractMinimumFact`) : null;
        if (!billed || !comp || !rate || (c.topic === 'billed_vs_contract_term' && !min)) {
          if (!problems.length) problems.push(`${where}: missing a required fact reference`);
          return;
        }
        try {
          const r = computeComparison({ topic: c.topic, label: c.label, billed: lite(billed), comparison: lite(comp), rate: lite(rate), contractMinimum: min ? lite(min) : null });
          results.push({ r, facts: [billed, comp, rate, ...(min ? [min] : [])], note: c.note });
        } catch (e) {
          if (e instanceof CalculationError) problems.push(`${where}: ${e.message}`);
          else throw e;
        }
      });

      const sums: { calc: ReturnType<typeof computePackageSum>; facts: FactRow[] }[] = [];
      out.packageSums.forEach((ps, i) => {
        const where = `packageSums[${i}]`;
        const pk = ps.packageFactRefs.map((r) => get(r, /^package_dimensions_cm$/, where)).filter((f): f is FactRow => !!f);
        const rep = get(ps.reportedVolumeFact, /^(measured_volume_cbm|declared_volume_cbm|billed_volume_cbm)$/, `${where}.reportedVolumeFact`);
        if (pk.length !== ps.packageFactRefs.length) return;
        try {
          const calc = computePackageSum({ label: ps.label, packages: pk.map(lite), reported: rep ? lite(rep) : null });
          sums.push({ calc, facts: [...pk, ...(rep ? [rep] : [])] });
        } catch (e) {
          if (e instanceof CalculationError) problems.push(`${where}: ${e.message}`);
          else throw e;
        }
      });
      finish(problems);

      // --- persist deterministic calculations
      const changedCalcs: string[] = [];
      const topics: string[] = [];
      const calcRefsByTopic = new Map<string, string[]>();
      const meta = { producedBy: 'billing', runId, evidenceRevision: revision };
      for (const { r } of results) {
        const refs: string[] = [];
        for (const c of r.calcs) {
          const { calc, changed } = await upsertCalculation(db, caseId, { ...c, caveat: r.caveat }, meta);
          refs.push(calc.ref);
          if (changed) changedCalcs.push(calc.ref);
        }
        calcRefsByTopic.set(r.topic, refs);
        topics.push(r.topic);
      }
      for (const { calc } of sums) {
        const { calc: row, changed } = await upsertCalculation(db, caseId, calc.calc, meta);
        calcRefsByTopic.set(calc.calc.topic, [row.ref]);
        if (changed) changedCalcs.push(row.ref);
        topics.push('package_sum');
      }

      // --- prose from the model is checked against the numbers that really exist
      const calcsNow = await listCalculations(caseId, {}, db);
      const allowed = allowedFigures([...facts.values()].map(lite), calcsNow);
      const prose = [out.summary, ...out.comparisons.map((c) => c.note ?? ''), ...out.missingVariables.map((m) => `${m.variable} ${m.reason}`)].join('\n');
      const bad = unsupportedFigures(prose, allowed);
      if (bad.length) problems.push(`Your text states figures that are not in the facts or calculations: ${bad.join(', ')}. Remove them; calculations are added by the system.`);
      if (forbiddenLanguage(prose).length) problems.push('Your text uses accusatory or entitlement language; keep to neutral facts.');
      finish(problems);

      // --- deterministic findings
      const findings: { f: FindingRow; outcome: string }[] = [];
      for (const { r, facts: used, note } of results) {
        const calcRefs = calcRefsByTopic.get(r.topic) ?? [];
        const spanRefs = [...new Set(used.flatMap((f) => f.spanRefs))];
        const res = await applyFinding(
          db,
          caseId,
          { topic: `volume:${r.topic}`, ...findingText(r, note), factRefs: used.map((f) => f.ref), calcRefs, spanRefs, basis: 'sourced', status: 'provisional' },
          { ...meta, reason: 'Recalculated after new or corrected facts.' },
        );
        if (res.outcome !== 'unchanged') findings.push({ f: res.finding, outcome: res.outcome });
      }
      for (const { calc, facts: used } of sums) {
        const refs = calcRefsByTopic.get(calc.calc.topic) ?? [];
        const res = await applyFinding(
          db,
          caseId,
          {
            topic: 'package_sum_vs_reported',
            title: `Package dimensions sum to ${formatCbm(calc.total, 2, 6)} CBM`,
            category: 'competing_explanation',
            severity: 'informational',
            status: 'supported',
            explanation: calc.reportedNote ?? `The listed package dimensions sum to ${formatCbm(calc.total, 2, 6)} CBM before rounding.`,
            factRefs: used.map((f) => f.ref),
            calcRefs: refs,
            spanRefs: [...new Set(used.flatMap((f) => f.spanRefs))],
            basis: 'sourced',
          },
          meta,
        );
        if (res.outcome !== 'unchanged') findings.push({ f: res.finding, outcome: res.outcome });
      }
      // Missing variables become "missing evidence" findings; ones no longer reported are resolved.
      const missingTopics = new Set<string>();
      for (const m of out.missingVariables) {
        const topic = `missing:${m.variable.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 50)}`;
        missingTopics.add(topic);
        const res = await applyFinding(
          db,
          caseId,
          { topic, title: `Missing: ${m.variable}`, category: 'missing_evidence', severity: 'needs_review', status: 'unresolved', explanation: m.reason, factRefs: [], calcRefs: [], spanRefs: [], basis: 'inference' },
          meta,
        );
        if (res.outcome !== 'unchanged') findings.push({ f: res.finding, outcome: res.outcome });
      }
      await query(
        `update findings set status = 'superseded', change_reason = 'The missing input is no longer reported as missing.', updated_at = now()
         where case_id = $1 and produced_by = 'billing' and topic like 'missing:%' and status <> 'superseded' and not (topic = any($2))`,
        [caseId, [...missingTopics]],
        db,
      );
      const n = results.length;
      return {
        result: { changedCalcs, topics, findings },
        summary:
          n || sums.length
            ? `Calculated ${n} comparison${n === 1 ? '' : 's'}${sums.length ? ` and ${sums.length} package sum${sums.length === 1 ? '' : 's'}` : ''}${out.missingVariables.length ? `; ${out.missingVariables.length} input${out.missingVariables.length === 1 ? '' : 's'} still missing` : ''}.`
            : `No comparison is possible yet; ${out.missingVariables.length} input${out.missingVariables.length === 1 ? ' is' : 's are'} missing.`,
      };
    },
    async after({ changedCalcs, topics, findings }) {
      // The signature of what this pass READ (captured before it started). Recomputing it here would hide facts
      // that arrived while the model was thinking and wrongly skip the follow-up pass.
      s.inputSignature.set('billing', sig);
      for (const { f, outcome } of findings) {
        await emit(outcome === 'revised' ? 'finding.revised' : 'finding.proposed', { findingRef: f.ref, topic: f.topic, supersedes: f.supersedesRef, by: 'billing' }, { producer: 'billing', causationId: triggerEventId });
      }
      if (changedCalcs.length) {
        await emit('calculation.completed', { calcRefs: changedCalcs, topics }, { producer: 'billing', causationId: triggerEventId });
      }
    },
  });
}

function findingText(r: ComparisonResult, note: string | null) {
  const money = (v: string) => formatMoney(v, r.currency);
  const noDiff = r.volumeDifference === '0';
  const higher = Number(r.volumeDifference) > 0;
  const tail = note ? ` ${note}` : '';
  switch (r.topic) {
    case 'billed_vs_declared':
      return {
        category: 'supported_discrepancy' as const,
        severity: noDiff ? ('informational' as const) : ('needs_review' as const),
        title: noDiff
          ? `Billed volume matches the packing-list estimate (${formatCbm(r.billedVolume)} CBM)`
          : `Billed volume (${formatCbm(r.billedVolume)} CBM) is ${higher ? 'higher' : 'lower'} than the packing-list estimate (${formatCbm(r.comparisonVolume)} CBM)`,
        explanation: `At ${money(r.rate)} per CBM the billed charge is ${money(r.billedCharge)} and the charge at the packing-list estimate is ${money(r.comparisonCharge)}, a ${money(r.difference)} comparison. A packing-list figure is a shipper's estimate, not a measurement, and does not by itself show the billed volume is wrong.${tail}`,
      };
    case 'billed_vs_measured':
      return {
        category: 'supported_discrepancy' as const,
        severity: noDiff ? ('informational' as const) : ('material' as const),
        title: noDiff
          ? `Billed volume matches the measured volume (${formatCbm(r.billedVolume)} CBM)`
          : `Measured volume (${formatCbm(r.comparisonVolume)} CBM) is ${higher ? 'lower' : 'higher'} than billed volume (${formatCbm(r.billedVolume)} CBM)`,
        explanation: `At ${money(r.rate)} per CBM the billed charge is ${money(r.billedCharge)} and the charge at the measured volume is ${money(r.comparisonCharge)}: a ${money(r.difference)} difference under review. This compares physical volume with billed volume; it does not establish the contractual chargeable volume or any refund.${tail}`,
      };
    case 'billed_vs_contract_term':
      return {
        category: 'competing_explanation' as const,
        severity: noDiff ? ('informational' as const) : ('needs_review' as const),
        title: noDiff
          ? `The stated minimum makes ${formatCbm(r.comparisonVolume)} CBM chargeable, matching the bill`
          : `Under the stated contract term, ${formatCbm(r.comparisonVolume)} CBM would be chargeable against ${formatCbm(r.billedVolume)} CBM billed`,
        explanation: `Applying the minimum chargeable volume quoted in the cited term to the measured volume gives ${formatCbm(r.comparisonVolume)} CBM, i.e. ${money(r.comparisonCharge)} at ${money(r.rate)} per CBM, against ${money(r.billedCharge)} billed: ${money(r.difference)} remains${noDiff ? ' (none) ' : ' '}unexplained by that term. Whether the term applies to this shipment still needs confirming.${tail}`,
      };
  }
}
