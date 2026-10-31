import { assertRefs, quoteAppearsIn, unknownRefs, type EvidenceIndex } from '@/domain/citations';
import { ValidationFailure } from '../tasks';

export function problemsToFailure(problems: string[]): never {
  throw new ValidationFailure(problems.slice(0, 12));
}

export function requireKnownRefs(refs: readonly string[], index: EvidenceIndex, where: string, problems: string[]): void {
  const bad = unknownRefs(refs, index);
  if (bad.length) problems.push(`${where}: unknown identifiers ${bad.join(', ')} (cite only identifiers that were given to you)`);
}

export function requireQuote(quote: string, spanRefs: readonly string[], index: EvidenceIndex, where: string, problems: string[]): void {
  const texts = spanRefs.map((r) => index.spans.get(r)?.text).filter((t): t is string => !!t);
  if (!texts.length) return; // unknown refs are reported separately
  if (!quoteAppearsIn(quote, texts)) problems.push(`${where}: the quote "${quote.slice(0, 60)}" does not appear in the cited spans ${spanRefs.join(', ')} (copy it exactly)`);
}

export function finish(problems: string[]): void {
  if (problems.length) problemsToFailure(problems);
}

export { assertRefs };
