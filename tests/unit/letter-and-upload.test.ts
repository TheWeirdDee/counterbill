import { describe, expect, it } from 'vitest';
import { diffLines, mergeAgentDraft, sectionsFingerprint, type LetterSectionData } from '@/domain/letter';
import { parseEml, sanitizeFilename, splitIntoSpans, UploadRejected, validateUpload } from '@/docs/parse';
import { providerJsonSchema } from '@/mozaik/schema';
import { BillingOutput, CaseOutput } from '@/domain/schemas';
import { displayFact } from '@/domain/format';

const sec = (id: string, text: string, extra: Partial<LetterSectionData> = {}): LetterSectionData => ({ id, title: id, text, refs: ['F1'], agentText: text, userEdited: false, ...extra });

describe('letter merge never overwrites the user', () => {
  it('first draft is taken as is', () => {
    const r = mergeAgentDraft(null, [sec('concern', 'a')]);
    expect(r.merged).toHaveLength(1);
    expect(r.conflicts).toHaveLength(0);
  });

  it('unedited sections follow the agent', () => {
    const r = mergeAgentDraft([sec('concern', 'old')], [sec('concern', 'new')]);
    expect(r.merged[0].text).toBe('new');
    expect(r.changedSectionIds).toEqual(['concern']);
  });

  it('a section the user edited keeps their words; the agent change becomes a proposal', () => {
    const current = [sec('comparison', 'my own wording', { agentText: 'agent v1', userEdited: true })];
    const r = mergeAgentDraft(current, [sec('comparison', 'agent v2 with new figures')]);
    expect(r.merged[0].text).toBe('my own wording');
    expect(r.merged[0].userEdited).toBe(true);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].text).toBe('agent v2 with new figures');
  });

  it('if the agent proposes nothing new for an edited section there is no conflict', () => {
    const current = [sec('comparison', 'my own wording', { agentText: 'agent v1', userEdited: true })];
    const r = mergeAgentDraft(current, [sec('comparison', 'agent v1')]);
    expect(r.conflicts).toHaveLength(0);
    expect(sectionsFingerprint(r.merged)).toBe(sectionsFingerprint(current));
  });

  it('diffs lines for the review panel', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    expect(d.map((x) => x.type)).toEqual(['same', 'remove', 'add', 'same']);
  });
});

describe('uploads are untrusted', () => {
  it('rejects unsupported extensions, spoofed content and oversized files', () => {
    expect(() => validateUpload('x.exe', Buffer.from('MZ'), 1000)).toThrow(UploadRejected);
    expect(() => validateUpload('fake.pdf', Buffer.from('this is not a pdf'), 1000)).toThrow(/does not look like a real/);
    expect(() => validateUpload('big.txt', Buffer.alloc(2000, 97), 1000)).toThrow(/larger than/);
    expect(() => validateUpload('empty.txt', Buffer.alloc(0), 1000)).toThrow(/empty/);
    expect(() => validateUpload('bin.txt', Buffer.from([0, 1, 2, 3]), 1000)).toThrow(UploadRejected);
  });

  it('accepts real PDFs, PNGs, JPEGs and text', () => {
    expect(validateUpload('a.pdf', Buffer.from('%PDF-1.7 ...'), 1000).type).toBe('pdf');
    expect(validateUpload('a.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), 1000).type).toBe('png');
    expect(validateUpload('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]), 1000).type).toBe('jpg');
    expect(validateUpload('a.eml', Buffer.from('From: a@b.c\n\nhi'), 1000).mime).toBe('message/rfc822');
  });

  it('sanitises filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\x\\inv<oice>.pdf')).toBe('inv_oice_.pdf');
    expect(sanitizeFilename('Survey — final.txt')).toBe('Survey — final.txt');
  });

  it('reads .eml headers and body', () => {
    const r = parseEml(Buffer.from('From: carrier@example.com\nTo: me@example.com\nDate: Mon, 3 Aug 2026 10:00:00 +0100\nSubject: Your invoice\n\nWe billed 1.10 CBM.'));
    expect(r.status).toBe('ready');
    expect(r.pages[0].text).toContain('Subject: Your invoice');
    expect(r.pages[0].text).toContain('We billed 1.10 CBM.');
  });

  it('splits pages into stable, offset-correct spans', () => {
    const page = 'Billed volume: 1.10 CBM\nRate: NGN 542,000 per CBM\n\nSecond paragraph here.';
    const spans = splitIntoSpans(page);
    expect(spans.map((s) => s.text)).toEqual(['Billed volume: 1.10 CBM\nRate: NGN 542,000 per CBM', 'Second paragraph here.']);
    for (const s of spans) expect(page.slice(s.start, s.end)).toBe(s.text);
  });
});

describe('structured output contract', () => {
  it('provider schemas are strict objects with every property required', () => {
    for (const schema of [BillingOutput, CaseOutput]) {
      const js = providerJsonSchema(schema) as { additionalProperties?: boolean; required?: string[]; properties?: Record<string, unknown> };
      expect(js.additionalProperties).toBe(false);
      expect(js.required?.sort()).toEqual(Object.keys(js.properties ?? {}).sort());
      expect(JSON.stringify(js)).not.toMatch(/minLength|maxLength|minItems|maxItems|\$schema/);
    }
  });

  it('Zod still enforces what the provider schema omits', () => {
    expect(() => BillingOutput.parse({ comparisons: [], packageSums: [], missingVariables: [], summary: '' })).toThrow();
  });
});

describe('display formatting', () => {
  it('shows money with separators and volumes at sensible precision', () => {
    expect(displayFact({ key: 'rate_per_cbm', value: '542000', unit: 'per CBM', currency: 'NGN' })).toBe('₦542,000 per CBM');
    expect(displayFact({ key: 'billed_volume_cbm', value: '1.1', unit: 'CBM', currency: null })).toBe('1.10 CBM');
    expect(displayFact({ key: 'package_dimensions_cm', value: '120x34x22', unit: 'cm', currency: null })).toBe('120 × 34 × 22 cm');
  });
});
