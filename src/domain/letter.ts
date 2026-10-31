/**
 * Letter assembly. Sender, recipient, subject, annex, response request and closing are filled by deterministic
 * code from case data (never invented by a model); the Drafting Agent supplies only the four body sections.
 * Reconciliation keeps user-edited sections intact and turns agent changes into proposals.
 */
import { contentHash } from './case-rules';
import { LETTER_SECTION_IDS, LETTER_SECTION_TITLE, SOURCE_CLASS_LABEL, DOCUMENT_KIND_LABEL, type DocumentKind, type LetterSectionId, type SourceClass } from './schemas';

export interface LetterSectionData {
  id: string;
  title: string;
  text: string;
  refs: string[];
  agentText: string;
  userEdited: boolean;
}

export interface AnnexEntry {
  letter: string;
  documentRef: string;
  filename: string;
  kind: string;
  sourceClass: string;
  note: string | null;
}

export const NOT_VERIFIED_NOTE = 'Edited by you — not verified by Counterbill.';

export function annexLabel(i: number): string {
  return `Annex ${String.fromCharCode(65 + i)}`;
}

export function buildAnnex(docs: { ref: string; originalFilename: string; kind: string; sourceClass: string; sourceLabel: string | null }[]): AnnexEntry[] {
  return docs.map((d, i) => ({
    letter: annexLabel(i),
    documentRef: d.ref,
    filename: d.originalFilename,
    kind: DOCUMENT_KIND_LABEL[d.kind as DocumentKind] ?? d.kind,
    sourceClass: d.sourceClass,
    note:
      d.sourceClass === 'primary_document'
        ? null
        : d.sourceClass === 'official_public_report'
          ? 'Excerpt of a published regulator report; context only, it does not itself prove the sender’s case.'
          : (d.sourceLabel ?? SOURCE_CLASS_LABEL[d.sourceClass as SourceClass]),
  }));
}

export function formatLetterDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function deterministicSections(args: {
  claimant: string;
  senderName: string;
  senderContact: string;
  counterparty: string;
  shipmentReference: string | null;
  annex: AnnexEntry[];
  today: Date;
  isDemo: boolean;
}): Record<'sender' | 'recipient' | 'subject' | 'response' | 'annex' | 'closing', { text: string; refs: string[] }> {
  const sender = [args.senderName || args.claimant || '[Your name]', args.senderContact || '[Your address, email and phone]', formatLetterDate(args.today)]
    .filter(Boolean)
    .join('\n');
  const ref = args.shipmentReference ?? '[shipment reference]';
  const recipient = [args.counterparty || '[Freight company name and address]', `Shipment reference: ${ref}`].join('\n');
  const annexText = args.annex.length
    ? args.annex.map((a) => `${a.letter} — ${a.kind}: ${a.filename}${a.note ? ` (${a.note})` : ''}`).join('\n')
    : '[No records are attached yet.]';
  return {
    sender: { text: sender, refs: [] },
    recipient: { text: recipient, refs: [] },
    subject: { text: `Request for clarification and review of freight charge for ${ref}`, refs: [] },
    response: {
      text: 'We would be grateful for a written response with the information requested above. If any figure or assumption in this letter is mistaken, please say so and we will correct it.',
      refs: [],
    },
    annex: { text: annexText + (args.isDemo ? '\n\nThis letter was prepared from a sample case; the invoice and packing list above are reconstructed for demonstration.' : ''), refs: [] },
    closing: { text: 'Yours faithfully,\n\n[Signature — to be added by the sender after review]\n' + (args.senderName || args.claimant || '[Name]'), refs: [] },
  };
}

export function toSections(parts: Record<string, { text: string; refs: string[] }>): LetterSectionData[] {
  return LETTER_SECTION_IDS.filter((id) => parts[id]).map((id) => ({
    id,
    title: LETTER_SECTION_TITLE[id as LetterSectionId],
    text: parts[id].text,
    refs: parts[id].refs,
    agentText: parts[id].text,
    userEdited: false,
  }));
}

export function sectionsFingerprint(sections: LetterSectionData[]): string {
  return contentHash(sections.map((s) => [s.id, s.text, s.refs, s.userEdited]));
}

export interface MergeResult {
  /** Sections for the new current draft: unedited sections follow the agent, edited sections keep the user's wording. */
  merged: LetterSectionData[];
  /** Sections where the agent proposes a change to text the user has edited. */
  conflicts: LetterSectionData[];
  changedSectionIds: string[];
}

/** Merge a fresh agent draft into the current draft without overwriting user-edited text. */
export function mergeAgentDraft(current: LetterSectionData[] | null, fresh: LetterSectionData[]): MergeResult {
  if (!current) return { merged: fresh, conflicts: [], changedSectionIds: fresh.map((s) => s.id) };
  const byId = new Map(current.map((s) => [s.id, s]));
  const merged: LetterSectionData[] = [];
  const conflicts: LetterSectionData[] = [];
  const changed: string[] = [];
  for (const f of fresh) {
    const cur = byId.get(f.id);
    if (!cur) {
      merged.push(f);
      changed.push(f.id);
      continue;
    }
    if (!cur.userEdited) {
      if (cur.text !== f.text || cur.refs.join() !== f.refs.join()) changed.push(f.id);
      merged.push({ ...f, userEdited: false });
    } else if (cur.agentText === f.text) {
      merged.push(cur); // agent proposes nothing new for this section
    } else {
      merged.push({ ...cur, agentText: cur.agentText });
      conflicts.push({ ...f, text: f.text, refs: f.refs, agentText: f.text, userEdited: true });
      changed.push(f.id);
    }
  }
  return { merged, conflicts, changedSectionIds: changed };
}

export interface LineDiff {
  type: 'same' | 'add' | 'remove';
  text: string;
}

/** Small LCS line diff for the reconcile panel and "what changed" view. */
export function diffLines(a: string, b: string): LineDiff[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const dp: number[][] = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      out.push({ type: 'same', text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'remove', text: x[i++] });
    else out.push({ type: 'add', text: y[j++] });
  }
  while (i < x.length) out.push({ type: 'remove', text: x[i++] });
  while (j < y.length) out.push({ type: 'add', text: y[j++] });
  return out;
}

export function letterPlainText(sections: LetterSectionData[]): string {
  const get = (id: string) => sections.find((s) => s.id === id)?.text ?? '';
  const body = ['concern', 'comparison', 'uncertainty', 'requests', 'response'].map(get).filter(Boolean).join('\n\n');
  return [get('sender'), '', get('recipient'), '', `Subject: ${get('subject')}`, '', body, '', 'Records referred to:', get('annex'), '', get('closing')].join('\n');
}
