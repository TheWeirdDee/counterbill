import { describe, expect, it } from 'vitest';
import {
  CalculationError,
  chargeableVolume,
  chargeFor,
  compareAmounts,
  decimalToString,
  formatCbm,
  formatMoney,
  packageCbm,
  parseDecimal,
  sumCbm,
  toCbm,
} from '@/domain/calculations';
import {
  allowedFigures,
  computeComparison,
  computePackageSum,
  figuresIn,
  forbiddenLanguage,
  unsupportedFigures,
  type FactLite,
} from '@/domain/case-rules';
import { assertRefs, CitationError, emptyIndex, quoteAppearsIn, refKind, unknownRefs } from '@/domain/citations';

const f = (ref: string, key: string, value: string, extra: Partial<FactLite> = {}): FactLite => ({
  ref,
  key,
  subject: null,
  value,
  unit: null,
  currency: null,
  status: 'active',
  ...extra,
});

// Dimensions of the six packages published in the NSC/NPERA report (31 Aug 2026).
const PUBLISHED_DIMS = ['120x34x22', '83x56x60', '67x46x34', '50x24x50', '109x38x40', '182x64x5'];

describe('CBM and currency arithmetic', () => {
  it('prices 1.10 CBM and 0.75 CBM at ₦542,000/CBM exactly', () => {
    expect(decimalToString(chargeFor('1.10', '542000'))).toBe('596200');
    expect(decimalToString(chargeFor('0.75', '542000'))).toBe('406500');
    const { difference, currency } = compareAmounts({ amount: '596200', currency: 'NGN' }, { amount: '406500', currency: 'NGN' });
    expect(decimalToString(difference)).toBe('189700');
    expect(currency).toBe('NGN');
  });

  it('is not subject to floating-point drift', () => {
    expect(0.1 * 3).not.toBe(0.3);
    expect(decimalToString(parseDecimal('0.1').mul(3))).toBe('0.3');
    expect(decimalToString(chargeFor('0.757348', '542000'))).toBe('410482.616');
  });

  it('sums the six published package dimensions to 0.757348 CBM before rounding', () => {
    const vols = PUBLISHED_DIMS.map((d) => {
      const [l, w, h] = d.split('x');
      return packageCbm({ length: l, width: w, height: h });
    });
    expect(decimalToString(sumCbm(vols))).toBe('0.757348');
    expect(formatCbm(sumCbm(vols), 2, 6)).toBe('0.757348');
  });

  it('handles package counts without multiplying twice and converts units', () => {
    expect(decimalToString(packageCbm({ length: '100', width: '100', height: '100', count: 3 }))).toBe('3');
    expect(decimalToString(packageCbm({ length: '1', width: '1', height: '1', unit: 'm' }))).toBe('1');
    expect(decimalToString(packageCbm({ length: '10', width: '10', height: '10', unit: 'ft' }).toDecimalPlaces(6))).toBe('28.316847');
    expect(decimalToString(toCbm('750000', 'cm3'))).toBe('0.75');
    expect(() => packageCbm({ length: '1', width: '1', height: '1', count: 0 })).toThrow(CalculationError);
    expect(() => packageCbm({ length: '1', width: '1', height: '1', unit: 'yd' })).toThrow(/Unsupported length unit/);
    expect(() => packageCbm({ length: '-1', width: '1', height: '1' })).toThrow(/negative/);
  });

  it('parses messy document numbers and rejects garbage', () => {
    expect(decimalToString(parseDecimal('₦542,000'))).toBe('542000');
    expect(decimalToString(parseDecimal('1,234,567.50'))).toBe('1234567.5');
    expect(() => parseDecimal('about one')).toThrow(CalculationError);
  });

  it('refuses to compare different currencies', () => {
    expect(() => compareAmounts({ amount: '10', currency: 'USD' }, { amount: '10', currency: 'NGN' })).toThrow(/conversion rate/);
  });

  it('applies a stated minimum separately from the physical measurement', () => {
    expect(decimalToString(chargeableVolume({ measuredCbm: '0.75', minimumCbm: '1' }))).toBe('1');
    expect(decimalToString(chargeableVolume({ measuredCbm: '1.4', minimumCbm: '1' }))).toBe('1.4');
    expect(decimalToString(chargeableVolume({ measuredCbm: '0.75', roundUpToCbm: '0.5' }))).toBe('1');
    expect(decimalToString(chargeableVolume({ measuredCbm: '0.75' }))).toBe('0.75');
  });

  it('formats money and volume readably', () => {
    expect(formatMoney('596200', 'NGN')).toBe('₦596,200');
    expect(formatMoney('189700.005', 'NGN')).toBe('₦189,700.01');
    expect(formatMoney('12.5', 'USD')).toBe('$12.50');
    expect(formatMoney('5', 'CHF')).toBe('CHF 5');
    expect(formatCbm('1.1')).toBe('1.10');
    expect(formatCbm('0.35')).toBe('0.35');
  });
});

describe('comparisons (the published case)', () => {
  const billed = f('F1', 'billed_volume_cbm', '1.10', { unit: 'CBM' });
  const declared = f('F2', 'declared_volume_cbm', '0.55', { unit: 'CBM' });
  const measured = f('F3', 'measured_volume_cbm', '0.75', { unit: 'CBM' });
  const rate = f('F4', 'rate_per_cbm', '542000', { currency: 'NGN', unit: 'per CBM' });

  it('reproduces ₦596,200 / ₦406,500 / ₦189,700 from facts', () => {
    const r = computeComparison({ topic: 'billed_vs_measured', label: 'x', billed, comparison: measured, rate });
    expect(r.billedCharge).toBe('596200');
    expect(r.comparisonCharge).toBe('406500');
    expect(r.difference).toBe('189700');
    expect(r.volumeDifference).toBe('0.35');
    expect(r.caveat).toMatch(/does not establish/);
    expect(r.calcs.map((c) => c.kind)).toEqual(['billed_charge', 'comparison_charge', 'volume_difference', 'charge_difference']);
  });

  it('compares against the packing-list estimate on its own basis', () => {
    const r = computeComparison({ topic: 'billed_vs_declared', label: 'x', billed, comparison: declared, rate });
    expect(r.comparisonCharge).toBe('298100');
    expect(r.difference).toBe('298100');
  });

  it('an evidenced 1.00 CBM minimum changes the comparison and removes the unsupported inference', () => {
    const min = f('F9', 'minimum_chargeable_cbm', '1.00', { unit: 'CBM' });
    const r = computeComparison({ topic: 'billed_vs_contract_term', label: 'x', billed, comparison: measured, rate, contractMinimum: min });
    expect(r.comparisonVolume).toBe('1');
    expect(r.difference).toBe('54200'); // 0.10 CBM × 542,000 still unexplained by a 1.00 minimum
    expect(r.calcs[0].kind).toBe('chargeable_volume');
    expect(r.caveat).toMatch(/still needs confirming/);
  });

  it('requires a contract minimum fact for the contract comparison', () => {
    expect(() => computeComparison({ topic: 'billed_vs_contract_term', label: 'x', billed, comparison: measured, rate })).toThrow(CalculationError);
  });

  it('rejects a rate without a currency and mismatched currencies cannot be silently mixed', () => {
    const noCur = f('F5', 'rate_per_cbm', '542000');
    expect(() => computeComparison({ topic: 'billed_vs_measured', label: 'x', billed, comparison: measured, rate: noCur })).toThrow(/no currency/);
  });

  it('computes the package sum and explains 0.75 versus 0.757348 without calling it a contradiction', () => {
    const packages = PUBLISHED_DIMS.map((d, i) => f(`F${10 + i}`, 'package_dimensions_cm', d, { subject: `Box ${i + 1}` }));
    const r = computePackageSum({ label: 'Survey dimensions', packages, reported: measured });
    expect(r.total).toBe('0.757348');
    expect(r.reportedNote).toMatch(/rounding or measurement-method question/);
    expect(r.calc.formula).toContain('0.757348');
  });
});

describe('prose gates', () => {
  const facts = [f('F1', 'billed_volume_cbm', '1.10', { unit: 'CBM' }), f('F4', 'rate_per_cbm', '542000', { currency: 'NGN' })];
  const calcs = [{ output: '596200', unit: 'NGN' }, { output: '0.35', unit: 'CBM' }];
  const allowed = allowedFigures(facts, calcs);

  it('extracts currency and CBM figures but ignores identifiers', () => {
    const t = 'Per D1-p1-s2 and F4 the bill was ₦596,200 for 1.10 CBM.';
    expect(figuresIn(t)).toEqual({ money: ['596200'], cbm: ['1.1'] });
  });

  it('treats a per-CBM rate as money, not volume', () => {
    expect(unsupportedFigures('Rate ₦542,000 per CBM; billed ₦596,200.', allowed)).toEqual([]);
    expect(allowed.cbm.has('542000')).toBe(false);
  });

  it('accepts supported figures and flags invented ones', () => {
    expect(unsupportedFigures('The bill was ₦596,200 for 1.10 CBM, 0.35 CBM above.', allowed)).toEqual([]);
    expect(unsupportedFigures('You are owed ₦999,999 for 2.5 CBM.', allowed)).toEqual(['₦999999', '2.5 CBM']);
  });

  it('blocks accusation, entitlement and threat language', () => {
    expect(forbiddenLanguage('You were defrauded.')).not.toEqual([]);
    expect(forbiddenLanguage('You are owed ₦189,700.')).not.toEqual([]);
    expect(forbiddenLanguage('This is a guaranteed refund.')).not.toEqual([]);
    expect(forbiddenLanguage('We will take legal action.')).not.toEqual([]);
    expect(forbiddenLanguage('The documents show a ₦189,700 difference; the rating basis needs confirmation.')).toEqual([]);
  });
});

describe('citations', () => {
  const idx = emptyIndex();
  idx.documents.add('D1');
  idx.spans.set('D1-p1-s1', { documentRef: 'D1', text: 'Volume: 1.10 CBM @ NGN 542,000 per CBM' });
  idx.facts.set('F1', { status: 'active' });

  it('classifies identifiers', () => {
    expect(refKind('D1-p1-s1')).toBe('span');
    expect(refKind('D1')).toBe('document');
    expect(refKind('FN3')).toBe('finding');
    expect(refKind('D1-p1')).toBe('unknown');
  });

  it('rejects nonexistent source identifiers', () => {
    expect(unknownRefs(['D1-p1-s1', 'F1'], idx)).toEqual([]);
    expect(unknownRefs(['D1-p1-s9', 'D7', 'F99', 'junk'], idx)).toEqual(['D1-p1-s9', 'D7', 'F99', 'junk']);
    expect(() => assertRefs(['D2-p1-s1'], idx)).toThrow(CitationError);
  });

  it('only accepts quotes that occur in the cited span', () => {
    const text = [idx.spans.get('D1-p1-s1')!.text];
    expect(quoteAppearsIn('1.10 CBM @ NGN 542,000', text)).toBe(true);
    expect(quoteAppearsIn('  volume:   1.10 cbm ', text)).toBe(true);
    expect(quoteAppearsIn('refund approved', text)).toBe(false);
  });
});
