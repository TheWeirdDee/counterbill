/**
 * Deterministic arithmetic for Counterbill.
 *
 * Every number that reaches a finding, a letter or an export is produced here, never by a
 * language model. Values are exact decimals (decimal.js) and travel as strings.
 */
import Decimal from 'decimal.js';

const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export class CalculationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_number'
      | 'negative_value'
      | 'currency_mismatch'
      | 'unit_unsupported'
      | 'missing_input'
      | 'zero_count',
    message: string,
  ) {
    super(message);
    this.name = 'CalculationError';
  }
}

/** Parse a decimal that a document or a model produced ("1,234.50", "₦542,000", "1.10"). */
export function parseDecimal(input: string | number | Decimal): Decimal {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new CalculationError('invalid_number', `Not a finite number: ${input}`);
    return new Dec(input);
  }
  if (input instanceof Decimal) return new Dec(input);
  const cleaned = String(input)
    .trim()
    .replace(/^[A-Za-z₦$€£]{1,4}\s*/u, '')
    .replace(/(?<=\d),(?=\d{3}(\D|$))/g, '')
    .replace(/\s/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new CalculationError('invalid_number', `Not a decimal number: "${input}"`);
  }
  return new Dec(cleaned);
}

export function tryParseDecimal(input: unknown): Decimal | null {
  if (input === null || input === undefined) return null;
  try {
    return parseDecimal(input as string);
  } catch {
    return null;
  }
}

function nonNegative(d: Decimal, what: string): Decimal {
  if (d.isNegative()) throw new CalculationError('negative_value', `${what} cannot be negative`);
  return d;
}

/** Plain decimal string with no exponent and trailing zeros trimmed. */
export function decimalToString(d: Decimal): string {
  const s = d.toFixed();
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export const LINEAR_TO_METRES: Record<string, string> = { m: '1', cm: '0.01', mm: '0.001', in: '0.0254', ft: '0.3048' };

/** Volume of one package type in CBM (m³): (l × w × h) / 1,000,000 for centimetres. */
export function packageCbm(args: {
  length: string | Decimal;
  width: string | Decimal;
  height: string | Decimal;
  unit?: string;
  count?: number;
}): Decimal {
  const unit = args.unit ?? 'cm';
  const factor = LINEAR_TO_METRES[unit];
  if (!factor) throw new CalculationError('unit_unsupported', `Unsupported length unit "${unit}"`);
  const count = args.count ?? 1;
  if (!Number.isInteger(count) || count < 1) throw new CalculationError('zero_count', 'Package count must be a positive integer');
  const f = new Dec(factor);
  const l = nonNegative(parseDecimal(args.length), 'length').mul(f);
  const w = nonNegative(parseDecimal(args.width), 'width').mul(f);
  const h = nonNegative(parseDecimal(args.height), 'height').mul(f);
  return l.mul(w).mul(h).mul(count);
}

/** Sum of unrounded per-package volumes. Rounding is a display decision, applied later. */
export function sumCbm(volumes: Decimal[]): Decimal {
  return volumes.reduce((acc, v) => acc.plus(v), new Dec(0));
}

export function toCbm(value: string | Decimal, unit: string): Decimal {
  const v = nonNegative(parseDecimal(value), 'volume');
  const u = unit.toLowerCase().replace(/\s/g, '');
  if (['cbm', 'm3', 'm³'].includes(u)) return v;
  if (['cm3', 'cm³'].includes(u)) return v.div(1_000_000);
  if (['ft3', 'ft³', 'cuft'].includes(u)) return v.mul('0.028316846592');
  throw new CalculationError('unit_unsupported', `Unsupported volume unit "${unit}"`);
}

/** volume × rate-per-CBM. Returned unrounded; callers round for display only. */
export function chargeFor(volumeCbm: string | Decimal, ratePerCbm: string | Decimal): Decimal {
  return nonNegative(parseDecimal(volumeCbm), 'volume').mul(nonNegative(parseDecimal(ratePerCbm), 'rate'));
}

export function roundMoney(d: Decimal): Decimal {
  return d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function roundCbm(d: Decimal, dp = 2): Decimal {
  return d.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

/** Subtract two monetary values; refuses to compare different currencies. */
export function compareAmounts(
  a: { amount: string | Decimal; currency: string },
  b: { amount: string | Decimal; currency: string },
): { difference: Decimal; currency: string } {
  if (a.currency.toUpperCase() !== b.currency.toUpperCase()) {
    throw new CalculationError(
      'currency_mismatch',
      `Cannot compare ${a.currency} with ${b.currency} without a dated conversion rate and its source.`,
    );
  }
  return { difference: parseDecimal(a.amount).minus(parseDecimal(b.amount)), currency: a.currency.toUpperCase() };
}

/**
 * Chargeable volume under an evidenced contractual term. The physical measurement is kept separate:
 * this only applies a minimum and optional rounding increment that a document actually states.
 */
export function chargeableVolume(args: {
  measuredCbm: string | Decimal;
  minimumCbm?: string | Decimal | null;
  roundUpToCbm?: string | Decimal | null;
}): Decimal {
  let v = nonNegative(parseDecimal(args.measuredCbm), 'measured volume');
  if (args.minimumCbm !== undefined && args.minimumCbm !== null) {
    const min = nonNegative(parseDecimal(args.minimumCbm), 'minimum volume');
    if (v.lt(min)) v = min;
  }
  if (args.roundUpToCbm !== undefined && args.roundUpToCbm !== null) {
    const inc = parseDecimal(args.roundUpToCbm);
    if (inc.lte(0)) throw new CalculationError('invalid_number', 'Rounding increment must be positive');
    v = v.div(inc).ceil().mul(inc);
  }
  return v;
}

const CURRENCY_SYMBOL: Record<string, string> = { NGN: '₦', USD: '$', EUR: '€', GBP: '£' };

export function formatMoney(amount: string | Decimal, currency: string): string {
  const d = roundMoney(parseDecimal(amount));
  const fixed = d.toFixed(2);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = frac === '00' ? grouped : `${grouped}.${frac}`;
  const sym = CURRENCY_SYMBOL[currency.toUpperCase()];
  return sym ? `${sym}${body}` : `${currency.toUpperCase()} ${body}`;
}

/** CBM for display: at least `minDp`, up to `maxDp` decimals, no spurious trailing zeros beyond minDp. */
export function formatCbm(value: string | Decimal, minDp = 2, maxDp = 6): string {
  const d = parseDecimal(value);
  let s = d.toDecimalPlaces(maxDp, Decimal.ROUND_HALF_UP).toFixed(maxDp);
  s = s.replace(/0+$/, '');
  const [i, f = ''] = s.split('.');
  return `${i}.${f.padEnd(minDp, '0')}`;
}
