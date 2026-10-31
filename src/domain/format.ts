import { formatCbm, formatMoney, tryParseDecimal } from './calculations';

/** Human-readable value for a stored fact: money with separators, volumes to sensible precision. */
export function displayFact(f: { key: string; value: string; unit: string | null; currency: string | null }): string {
  const n = tryParseDecimal(f.value);
  if (n && f.currency && (f.key === 'rate_per_cbm' || /_amount$/.test(f.key))) {
    return `${formatMoney(n, f.currency)}${f.key === 'rate_per_cbm' ? ' per CBM' : ''}`;
  }
  if (n && f.key !== 'rate_per_cbm' && /_cbm$/.test(f.key)) return `${formatCbm(n)} CBM`;
  if (f.key === 'package_dimensions_cm') return `${f.value.replace(/x/g, ' × ')} cm`;
  return `${f.value}${f.unit ? ` ${f.unit}` : ''}${f.currency ? ` ${f.currency}` : ''}`;
}
