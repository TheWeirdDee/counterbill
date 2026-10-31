/**
 * Citation integrity. Models may only cite identifiers that exist in the case's evidence store,
 * and quoted text must actually occur in the span it is attributed to.
 *
 * Identifier scheme (all scoped to one case, so they are short enough for a model to copy verbatim):
 *   D3 document · D3-p2-s5 span (document, page, span) · F7 fact · C2 calculation · FN4 finding · Q1 question
 */

export type RefKind = 'document' | 'span' | 'fact' | 'calculation' | 'finding' | 'question' | 'unknown';

export function refKind(ref: string): RefKind {
  if (/^D\d+-p\d+-s\d+$/.test(ref)) return 'span';
  if (/^D\d+$/.test(ref)) return 'document';
  if (/^F\d+$/.test(ref)) return 'fact';
  if (/^C\d+$/.test(ref)) return 'calculation';
  if (/^FN\d+$/.test(ref)) return 'finding';
  if (/^Q\d+$/.test(ref)) return 'question';
  return 'unknown';
}

export interface EvidenceIndex {
  spans: Map<string, { documentRef: string; text: string }>;
  documents: Set<string>;
  facts: Map<string, { status: string }>;
  calculations: Set<string>;
  findings: Set<string>;
  questions: Set<string>;
}

export function emptyIndex(): EvidenceIndex {
  return { spans: new Map(), documents: new Set(), facts: new Map(), calculations: new Set(), findings: new Set(), questions: new Set() };
}

export class CitationError extends Error {
  constructor(
    public readonly unknown: string[],
    message?: string,
  ) {
    super(message ?? `Unknown evidence identifiers: ${unknown.join(', ')}`);
    this.name = 'CitationError';
  }
}

export function unknownRefs(refs: readonly string[], index: EvidenceIndex): string[] {
  const bad: string[] = [];
  for (const r of refs) {
    const k = refKind(r);
    const ok =
      (k === 'span' && index.spans.has(r)) ||
      (k === 'document' && index.documents.has(r)) ||
      (k === 'fact' && index.facts.has(r)) ||
      (k === 'calculation' && index.calculations.has(r)) ||
      (k === 'finding' && index.findings.has(r)) ||
      (k === 'question' && index.questions.has(r));
    if (!ok) bad.push(r);
  }
  return bad;
}

export function assertRefs(refs: readonly string[], index: EvidenceIndex): void {
  const bad = unknownRefs(refs, index);
  if (bad.length) throw new CitationError(bad);
}

export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** A quote is acceptable when its normalised form occurs inside the concatenated cited spans. */
export function quoteAppearsIn(quote: string, spanTexts: readonly string[]): boolean {
  const q = normalizeForQuote(quote).replace(/[.…]+$/, '');
  if (q.length < 2) return false;
  const haystack = normalizeForQuote(spanTexts.join(' '));
  return haystack.includes(q);
}

export function spanDocumentRef(spanRef: string): string {
  return spanRef.split('-')[0];
}
