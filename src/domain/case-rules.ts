/**
 * Deterministic case logic: turns facts into calculation records, gates model prose on the
 * numbers it may state, and decides when a finding is a genuine revision.
 */
import { createHash } from 'node:crypto';
import {
  CalculationError,
  chargeFor,
  chargeableVolume,
  compareAmounts,
  decimalToString,
  formatCbm,
  formatMoney,
  packageCbm,
  parseDecimal,
  roundCbm,
  roundMoney,
  sumCbm,
  toCbm,
  tryParseDecimal,
} from './calculations';
import type { ComparisonTopic } from './schemas';

export interface FactLite {
  ref: string;
  key: string;
  subject: string | null;
  value: string;
  unit: string | null;
  currency: string | null;
  status: string;
}

export interface CalcDraft {
  /** Stable identity so reruns with identical inputs are idempotent. */
  topic: string;
  kind: 'package_sum' | 'billed_charge' | 'comparison_charge' | 'charge_difference' | 'volume_difference' | 'chargeable_volume';
  label: string;
  formula: string;
  inputFactRefs: string[];
  assumptions: string[];
  /** Exact decimal string. */
  output: string;
  unit: string;
  display: string;
}

export interface ComparisonResult {
  topic: ComparisonTopic;
  label: string;
  calcs: CalcDraft[];
  billedVolume: string;
  comparisonVolume: string;
  rate: string;
  currency: string;
  billedCharge: string;
  comparisonCharge: string;
  difference: string;
  volumeDifference: string;
  /** What this comparison means and does not mean. */
  caveat: string;
}

export function factVolumeCbm(f: FactLite): string {
  return decimalToString(toCbm(f.value, f.unit?.trim() || 'cbm'));
}

export function factRate(f: FactLite): { rate: string; currency: string } {
  if (!f.currency) throw new CalculationError('missing_input', `Rate fact ${f.ref} has no currency`);
  return { rate: decimalToString(parseDecimal(f.value)), currency: f.currency.toUpperCase() };
}

const BASIS_LABEL: Record<ComparisonTopic, string> = {
  billed_vs_declared: 'packing-list (declared) volume',
  billed_vs_measured: 'surveyed (measured) volume',
  billed_vs_contract_term: 'chargeable volume under the stated contract term',
};

export function computeComparison(args: {
  topic: ComparisonTopic;
  label: string;
  billed: FactLite;
  comparison: FactLite;
  rate: FactLite;
  contractMinimum?: FactLite | null;
}): ComparisonResult {
  const { topic, billed, comparison, rate, contractMinimum } = args;
  const { rate: rateStr, currency } = factRate(rate);
  const billedV = parseDecimal(factVolumeCbm(billed));
  let compV = parseDecimal(factVolumeCbm(comparison));
  const assumptions = [
    `Rate ${formatMoney(rateStr, currency)} per CBM taken from ${rate.ref}.`,
    'Amounts are comparisons under stated assumptions, not amounts owed or refundable.',
  ];
  const calcs: CalcDraft[] = [];
  const inputs = [billed.ref, comparison.ref, rate.ref];

  if (topic === 'billed_vs_contract_term') {
    if (!contractMinimum) throw new CalculationError('missing_input', 'A contract minimum fact is required for this comparison');
    const min = factVolumeCbm(contractMinimum);
    const chargeable = chargeableVolume({ measuredCbm: compV, minimumCbm: min });
    inputs.push(contractMinimum.ref);
    calcs.push({
      topic: `${topic}:chargeable_volume`,
      kind: 'chargeable_volume',
      label: 'Chargeable volume under the stated minimum',
      formula: `max(${formatCbm(compV)} CBM measured, ${formatCbm(min)} CBM stated minimum) = ${formatCbm(chargeable)} CBM`,
      inputFactRefs: [comparison.ref, contractMinimum.ref],
      assumptions: ['Applies only the minimum quoted in the cited term; no other rounding or surcharge is assumed.'],
      output: decimalToString(chargeable),
      unit: 'CBM',
      display: `${formatCbm(chargeable)} CBM`,
    });
    compV = chargeable;
  }

  const billedCharge = chargeFor(billedV, rateStr);
  const compCharge = chargeFor(compV, rateStr);
  const { difference } = compareAmounts({ amount: billedCharge, currency }, { amount: compCharge, currency });
  const volDiff = billedV.minus(compV);

  calcs.push(
    {
      topic: `${topic}:billed_charge`,
      kind: 'billed_charge',
      label: 'Charge at the billed volume',
      formula: `${formatCbm(billedV)} CBM × ${formatMoney(rateStr, currency)} per CBM = ${formatMoney(billedCharge, currency)}`,
      inputFactRefs: [billed.ref, rate.ref],
      assumptions,
      output: decimalToString(billedCharge),
      unit: currency,
      display: formatMoney(billedCharge, currency),
    },
    {
      topic: `${topic}:comparison_charge`,
      kind: 'comparison_charge',
      label: `Charge at the ${BASIS_LABEL[topic]}`,
      formula: `${formatCbm(compV)} CBM × ${formatMoney(rateStr, currency)} per CBM = ${formatMoney(compCharge, currency)}`,
      inputFactRefs: inputs,
      assumptions,
      output: decimalToString(compCharge),
      unit: currency,
      display: formatMoney(compCharge, currency),
    },
    {
      topic: `${topic}:volume_difference`,
      kind: 'volume_difference',
      label: 'Volume difference (billed minus comparison)',
      formula: `${formatCbm(billedV)} CBM − ${formatCbm(compV)} CBM = ${formatCbm(volDiff)} CBM`,
      inputFactRefs: inputs,
      assumptions: [],
      output: decimalToString(volDiff),
      unit: 'CBM',
      display: `${formatCbm(volDiff)} CBM`,
    },
    {
      topic: `${topic}:charge_difference`,
      kind: 'charge_difference',
      label: 'Documented difference under review',
      formula: `${formatMoney(billedCharge, currency)} − ${formatMoney(compCharge, currency)} = ${formatMoney(difference, currency)}`,
      inputFactRefs: inputs,
      assumptions,
      output: decimalToString(difference),
      unit: currency,
      display: formatMoney(difference, currency),
    },
  );

  const caveat =
    topic === 'billed_vs_contract_term'
      ? 'Computed under a minimum that the cited term states; whether that term applies to this shipment still needs confirming.'
      : 'This compares physical or declared volume with the billed volume. It does not establish the contractual chargeable volume or any entitlement to a refund.';

  return {
    topic,
    label: args.label,
    calcs,
    billedVolume: decimalToString(billedV),
    comparisonVolume: decimalToString(compV),
    rate: rateStr,
    currency,
    billedCharge: decimalToString(billedCharge),
    comparisonCharge: decimalToString(compCharge),
    difference: decimalToString(difference),
    volumeDifference: decimalToString(volDiff),
    caveat,
  };
}

export function parseDimensions(value: string): { l: string; w: string; h: string } | null {
  const m = value.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
  return m ? { l: m[1], w: m[2], h: m[3] } : null;
}

export function computePackageSum(args: {
  label: string;
  packages: FactLite[];
  reported?: FactLite | null;
}): { calc: CalcDraft; total: string; reportedNote: string | null } {
  if (args.packages.length === 0) throw new CalculationError('missing_input', 'No package dimension facts supplied');
  const vols = args.packages.map((p) => {
    const dims = parseDimensions(p.value);
    if (!dims) throw new CalculationError('invalid_number', `Cannot read dimensions from ${p.ref}: "${p.value}"`);
    return { fact: p, v: packageCbm({ length: dims.l, width: dims.w, height: dims.h, unit: 'cm' }) };
  });
  const total = sumCbm(vols.map((x) => x.v));
  const parts = vols.map((x, i) => `${args.packages[i].subject ?? `Package ${i + 1}`}: ${formatCbm(x.v, 6, 6)}`).join('; ');
  let reportedNote: string | null = null;
  const assumptions = [
    'Each package volume is (length × width × height in cm) ÷ 1,000,000, summed before any rounding.',
    'Package counts are taken from the number of dimension facts; no package is multiplied twice.',
  ];
  if (args.reported) {
    const rep = parseDecimal(factVolumeCbm(args.reported));
    reportedNote = `The document reports ${formatCbm(rep)} CBM; the dimension sum is ${formatCbm(total, 2, 6)} CBM (${formatCbm(roundCbm(total), 2)} CBM to two decimal places). The gap is a rounding or measurement-method question, not by itself a contradiction.`;
    assumptions.push(reportedNote);
  }
  return {
    total: decimalToString(total),
    reportedNote,
    calc: {
      topic: `package_sum:${args.packages.map((p) => p.ref).join('+')}`,
      kind: 'package_sum',
      label: args.label,
      formula: `Σ (L × W × H ÷ 1,000,000) over ${vols.length} packages = ${formatCbm(total, 2, 6)} CBM  [${parts}]`,
      inputFactRefs: args.packages.map((p) => p.ref),
      assumptions,
      output: decimalToString(total),
      unit: 'CBM',
      display: `${formatCbm(total, 2, 6)} CBM`,
    },
  };
}

// ---------------------------------------------------------------- text gates

/** Extract currency-tagged and CBM-tagged figures from prose, normalised to plain decimals. */
export function figuresIn(textValue: string): { money: string[]; cbm: string[] } {
  const money: string[] = [];
  const cbm: string[] = [];
  const stripped = textValue.replace(/\bD\d+(?:-p\d+-s\d+)?\b|\b(?:F|C|Q|FN)\d+\b/g, ' ');
  for (const m of stripped.matchAll(/(?:₦|NGN\s?|USD\s?|\$|€|£)\s?(\d[\d,]*(?:\.\d+)?)/g)) money.push(canonical(m[1]));
  for (const m of stripped.matchAll(/(\d[\d,]*(?:\.\d+)?)\s?(?:CBM|cbm|cubic metres|cubic meters|m³)/g)) cbm.push(canonical(m[1]));
  return { money, cbm };
}

function canonical(n: string): string {
  const d = tryParseDecimal(n.replace(/,/g, ''));
  return d ? decimalToString(d) : n;
}

/** The values a piece of prose is allowed to state: stored facts and deterministic calculations. */
export function allowedFigures(facts: FactLite[], calcs: { output: string; unit: string }[]): { money: Set<string>; cbm: Set<string> } {
  const money = new Set<string>();
  const cbm = new Set<string>();
  const addCbm = (v: string) => {
    const d = tryParseDecimal(v);
    if (!d) return;
    cbm.add(decimalToString(d));
    cbm.add(decimalToString(roundCbm(d, 2)));
    cbm.add(decimalToString(roundCbm(d, 3)));
    cbm.add(decimalToString(roundCbm(d, 6)));
  };
  const addMoney = (v: string) => {
    const d = tryParseDecimal(v);
    if (!d) return;
    money.add(decimalToString(d));
    money.add(decimalToString(roundMoney(d)));
    money.add(decimalToString(d.toDecimalPlaces(0)));
  };
  for (const f of facts) {
    if (f.status === 'rejected') continue;
    if (/amount|^rate/.test(f.key)) addMoney(f.value);
    else if (/cbm/.test(f.key) || /^(cbm|m3|m³)$/i.test(f.unit ?? '')) {
      try {
        addCbm(factVolumeCbm(f));
      } catch {
        /* non-numeric fact */
      }
    } else if (f.key === 'package_dimensions_cm') {
      const d = parseDimensions(f.value);
      if (d) addCbm(decimalToString(packageCbm({ length: d.l, width: d.w, height: d.h })));
    }
  }
  for (const c of calcs) {
    if (c.unit === 'CBM') addCbm(c.output);
    else addMoney(c.output);
  }
  return { money, cbm };
}

export function unsupportedFigures(textValue: string, allowed: { money: Set<string>; cbm: Set<string> }): string[] {
  const { money, cbm } = figuresIn(textValue);
  return [...money.filter((m) => !allowed.money.has(m)).map((m) => `₦${m}`), ...cbm.filter((c) => !allowed.cbm.has(c)).map((c) => `${c} CBM`)];
}

const FORBIDDEN = [
  /\bdefraud/i,
  /\bfraud(ulent)?\b/i,
  /\byou are owed\b/i,
  /\bwe are owed\b/i,
  /\bguaranteed? refund\b/i,
  /\brefund (is|will be) (due|owed)\b/i,
  /\billegal(ly)?\b/i,
  /\bunlawful(ly)?\b/i,
  /\bovercharge[sd]? (us|me) (unlawfully|illegally)\b/i,
  /\bwithin \d+ (working |business )?days\b.*\b(or|otherwise|failing)\b/i,
  /\bsue\b|\blegal action\b|\blitigation\b/i,
];

/** Language the product promises never to emit: accusations, entitlement and threats. */
export function forbiddenLanguage(textValue: string): string[] {
  return FORBIDDEN.filter((re) => re.test(textValue)).map((re) => re.source);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
}

export function normalizeTopic(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_:.-]+/g, '_').slice(0, 80);
}

/**
 * Which assessment classifications the current calculations and contract reading actually support. This is a
 * deterministic guard on the Case Agent: a reading may not claim a measurement difference before any measurement
 * exists, or a contract explanation before a stated term has been calculated.
 */
export function allowedClassifications(
  calcs: { topic: string; kind: string; output: string }[],
  interpretation: { termsStatus: string } | null,
): { allowed: string[]; reasons: Record<string, string> } {
  const has = (prefix: string) => calcs.some((c) => c.topic.startsWith(prefix));
  const termsFound = interpretation?.termsStatus === 'terms_found';
  const anyComparison = calcs.some((c) => c.kind === 'charge_difference');
  const reasons: Record<string, string> = {};
  const rule = (cls: string, ok: boolean, why: string) => {
    if (!ok) reasons[cls] = why;
    return ok;
  };
  const all = [
    ['insufficient_evidence', rule('insufficient_evidence', !anyComparison, 'a comparison has already been calculated, so the evidence is not "insufficient"')],
    ['declared_volume_conflicts_with_bill', rule('declared_volume_conflicts_with_bill', has('billed_vs_declared:') && !has('billed_vs_measured:'), 'it applies only while the packing-list estimate is the only other volume (no measurement yet)')],
    ['measured_volume_differs_basis_unresolved', rule('measured_volume_differs_basis_unresolved', has('billed_vs_measured:') && !(termsFound && has('billed_vs_contract_term:')), has('billed_vs_measured:') ? 'a stated contract term has been calculated, so the reading must account for it' : 'there is no calculation against a measured volume yet')],
    ['contract_term_may_explain_bill', rule('contract_term_may_explain_bill', termsFound && has('billed_vs_contract_term:'), 'no stated contract term has been found and calculated yet')],
    ['bill_consistent_with_records', rule('bill_consistent_with_records', calcs.some((c) => c.kind === 'volume_difference') && calcs.filter((c) => c.kind === 'volume_difference').every((c) => c.output === '0'), 'a calculated volume difference is not zero')],
    ['conflicting_evidence_needs_input', true],
  ] as const;
  return { allowed: all.filter(([, ok]) => ok).map(([c]) => c), reasons };
}

const STOP = new Set('a an and are as at be by can do does for from has have how i if in is it its me my of on or our please clarify provide the their there this to we what when where which who whom why will with would you your'.split(' '));

/** Content words of a question, for near-duplicate detection (case and punctuation insensitive). */
export function questionWords(prompt: string): Set<string> {
  return new Set(prompt.toLowerCase().replace(/[^a-z0-9.]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w)));
}

/** Two questions ask the same thing when most of their content words coincide. */
export function similarQuestions(a: string, b: string, threshold = 0.6): boolean {
  const x = questionWords(a);
  const y = questionWords(b);
  if (!x.size || !y.size) return false;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter) >= threshold || inter / Math.min(x.size, y.size) >= 0.85;
}
