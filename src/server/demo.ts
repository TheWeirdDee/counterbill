/**
 * Public sample cases. Inputs are labelled fixtures derived from published regulator reports; every run on them
 * is a fresh, isolated case executed by the same Mozaik pipeline as a private case. Nothing here produces findings.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createCase, getCase, listDocuments, type CaseRow } from '@/db/repo';
import { UploadRejected } from '@/docs/parse';
import type { DocumentKind, SourceClass } from '@/domain/schemas';
import { addDocument, parseAndReassess, parseQueuedDocument } from './documents';
import { requestReassess } from './runs';

interface FixtureDoc {
  file: string;
  kind: DocumentKind;
  sourceClass: SourceClass;
  label: string;
  url?: string;
  published?: string;
  displayName: string;
}
export interface DemoStep {
  id: string;
  title: string;
  description: string;
  doc: FixtureDoc;
}
export interface DemoCase {
  slug: string;
  title: string;
  summary: string;
  caseName: string;
  claimant: string;
  counterparty: string;
  origin: string;
  destination: string;
  shipmentClass: string;
  currency: string;
  sampleLabel: string;
  folder: string;
  source: { publisher: string; title: string; published: string; url: string; verified: string; limitation: string };
  initial: FixtureDoc[];
  concernFile: string;
  /** Evidence the visitor can add during the run to trigger a reassessment. */
  steps: DemoStep[];
  publicFacts: string[];
  /** Headline figures from the published report, for the examples listing. */
  figures: { value: string; label: string }[];
}

const RECON = 'Reconstructed for demonstration; not an original invoice';
const VERIFIED = 'Retrieved and read in full from the publisher’s page on 31 October 2026';

export const DEMO_CASES: DemoCase[] = [
  {
    slug: 'volume-dispute-aug-2026',
    title: 'A volume charge that does not match the packing list',
    summary:
      'Six packages from China to Lagos were billed at 1.10 CBM against a packing-list estimate of 0.55 CBM. A published survey later measured 0.75 CBM. The regulator did not establish how the carrier rated the 1.10 CBM.',
    caseName: 'Disputed LCL volume charge — China to Lagos (example)',
    claimant: 'Import with Martha (as named in the NSC report)',
    counterparty: '3 Brothers Cargo (as named in the NSC report)',
    origin: 'China',
    destination: 'Lagos, Nigeria',
    shipmentClass: 'LCL',
    currency: 'NGN',
    sampleLabel: 'Based on a published report · Nigerian Shippers’ Council, 31 August 2026',
    folder: 'public-case-aug-2026',
    concernFile: 'user-concern.txt',
    source: {
      publisher: 'Nigerian Shippers’ Council (NPERA complaints unit)',
      title: 'NPERA Probe Finds Disputed Cargo Volume Overstated by 0.35 CBM in Freight Billing Case',
      published: '31 August 2026',
      url: 'https://shipperscouncil.gov.ng/npera-probe-finds-disputed-cargo-volume-overstated-by-0-35-cbm-in-freight-billing-case/',
      verified: VERIFIED,
      limitation: 'The report is a regulator’s public narrative. The underlying invoice, packing list and contract were not published, so the invoice and packing list here are reconstructions.',
    },
    initial: [
      { file: 'invoice-reconstructed.txt', kind: 'invoice', sourceClass: 'reconstructed_demo', label: RECON, displayName: 'Freight invoice (reconstruction).txt' },
      { file: 'packing-list-reconstructed.txt', kind: 'packing_list', sourceClass: 'reconstructed_demo', label: 'Reconstructed for demonstration; not an original packing list', displayName: 'Packing list (reconstruction).txt' },
    ],
    steps: [
      {
        id: 'survey',
        title: 'Add the published survey finding',
        description: 'The joint survey of 14 August 2026, taken from the regulator’s published report.',
        doc: { file: 'survey-excerpt.txt', kind: 'survey', sourceClass: 'official_public_report', label: 'Source-derived excerpt of a published regulator report', url: 'https://shipperscouncil.gov.ng/npera-probe-finds-disputed-cargo-volume-overstated-by-0-35-cbm-in-freight-billing-case/', published: '31 August 2026', displayName: 'NSC report excerpt — joint survey.txt' },
      },
      {
        id: 'rate-sheet',
        title: 'Add a hypothetical rate sheet with a 1.00 CBM minimum',
        description: 'Not in the published report. Shows how a stated contract term changes the conclusion.',
        doc: { file: 'hypothetical-rate-sheet.txt', kind: 'quote', sourceClass: 'hypothetical_demo', label: 'Hypothetical illustration; not part of the published report', displayName: 'Rate sheet (hypothetical illustration).txt' },
      },
    ],
    figures: [
      { value: '1.10 CBM', label: 'billed' },
      { value: '0.75 CBM', label: 'surveyed' },
      { value: '₦189,700', label: 'difference under review' },
    ],
    publicFacts: [
      'Six-package LCL consignment billed at 1.10 CBM; packing list estimated 0.55 CBM.',
      'Freight rate ₦542,000 per CBM; billed ₦596,200; ₦406,500 at the surveyed 0.75 CBM; ₦189,700 difference.',
      'The six surveyed dimension sets sum to 0.757348 CBM before rounding (the report states 0.75 CBM).',
      'The report states the rating methodology and contract terms behind 1.10 CBM were not established.',
    ],
  },
  {
    slug: 'cargo-classification-jun-2026',
    title: 'A full container that arrived as groupage cargo',
    summary:
      'An importer says he booked a dedicated 40ft container (FCL) but the cargo was consolidated (LCL). The regulator found a communication breakdown and set a flat settlement. This sample asks who approved the format and which quote applied.',
    caseName: 'FCL booked, shipped as LCL — China to Lagos (example)',
    claimant: 'Multi Graphic Advertising Company (as named in the NSC report)',
    counterparty: 'Jecmek Divine International Logistics (as named in the NSC report)',
    origin: 'China',
    destination: 'Lagos, Nigeria',
    shipmentClass: 'LCL',
    currency: 'NGN',
    sampleLabel: 'Based on a published report · Nigerian Shippers’ Council, 23 June 2026',
    folder: 'cargo-classification-jun-2026',
    concernFile: 'user-concern.txt',
    source: {
      publisher: 'Nigerian Shippers’ Council',
      title: 'Cargo Conversion Dispute: NSC Resolves Freight and Classification Row Between Importer and Logistics Firm',
      published: '23 June 2026',
      url: 'https://shipperscouncil.gov.ng/cargo-conversion-dispute-nsc-resolves-freight-and-classification-row-between-importer-and-logistics-firm/',
      verified: VERIFIED,
      limitation: 'Only the regulator’s narrative is public. No original quote, booking note or bill of lading was published, so none is reconstructed here.',
    },
    initial: [
      { file: 'nsc-report-excerpt.txt', kind: 'other', sourceClass: 'official_public_report', label: 'Source-derived excerpt of a published regulator report', url: 'https://shipperscouncil.gov.ng/cargo-conversion-dispute-nsc-resolves-freight-and-classification-row-between-importer-and-logistics-firm/', published: '23 June 2026', displayName: 'NSC report excerpt — cargo conversion.txt' },
    ],
    steps: [],
    figures: [
      { value: '≈ 50 CBM', label: 'beach umbrellas' },
      { value: '₦27,132,000', label: 'charges faced' },
      { value: '₦19,000,000', label: 'flat settlement set' },
    ],
    publicFacts: [
      'Roughly 50 CBM of beach umbrellas; the importer says a dedicated 40ft FCL was contracted.',
      'The cargo was handled as consolidated LCL; charges faced were ₦27,132,000.',
      'The meeting found a contract with the forwarder and a communication breakdown, and set a flat ₦19,000,000 settlement.',
    ],
  },
];

export function getDemoCase(slug: string): DemoCase | undefined {
  return DEMO_CASES.find((d) => d.slug === slug);
}

function readFixture(folder: string, file: string): Buffer {
  return fs.readFileSync(path.resolve('fixtures', folder, file));
}

/** Create a fresh, isolated sample case with its starting evidence already parsed. */
export async function createDemoCaseInstance(slug: string, demoTokenHash: string): Promise<CaseRow> {
  const demo = getDemoCase(slug);
  if (!demo) throw new Error(`Unknown sample case "${slug}"`);
  const concern = readFixture(demo.folder, demo.concernFile);
  const c = await createCase(
    {
      name: demo.caseName,
      claimant: demo.claimant,
      counterparty: demo.counterparty,
      origin: demo.origin,
      destination: demo.destination,
      shipmentClass: demo.shipmentClass,
      currency: demo.currency,
      concern: concern.toString('utf8'),
      status: 'draft',
      demoSlug: slug,
      sampleLabel: demo.sampleLabel,
    },
    { demoTokenHash },
  );
  for (const d of demo.initial) {
    const doc = await addDocument(c.id, { filename: d.displayName, bytes: readFixture(demo.folder, d.file), kind: d.kind, sourceClass: d.sourceClass, sourceLabel: d.label, sourceUrl: d.url ?? null, sourcePublished: d.published ?? null });
    await parseQueuedDocument(c.id, doc.ref);
  }
  const stmt = await addDocument(c.id, { filename: 'Your statement (example).txt', bytes: concern, kind: 'user_statement', sourceClass: 'user_statement', sourceLabel: 'Sample user statement written for the demonstration' });
  await parseQueuedDocument(c.id, stmt.ref);
  return (await getCase(c.id))!;
}

/** Add one of the case's published evidence steps (e.g. the survey) and trigger a targeted reassessment. */
export async function addDemoEvidence(caseId: string, stepId: string): Promise<{ documentRef: string }> {
  const c = await getCase(caseId);
  const demo = c?.demoSlug ? getDemoCase(c.demoSlug) : undefined;
  const step = demo?.steps.find((s) => s.id === stepId);
  if (!c || !demo || !step) throw new UploadRejected('unsupported_type', 'That sample evidence is not available for this case.');
  const docs = await listDocuments(caseId);
  if (docs.some((d) => d.originalFilename === step.doc.displayName)) throw new UploadRejected('unsupported_type', 'That evidence has already been added.');
  const d = step.doc;
  const doc = await addDocument(caseId, { filename: d.displayName, bytes: readFixture(demo.folder, d.file), kind: d.kind, sourceClass: d.sourceClass, sourceLabel: d.label, sourceUrl: d.url ?? null, sourcePublished: d.published ?? null });
  await parseAndReassess(caseId, doc.ref);
  void requestReassess;
  return { documentRef: doc.ref };
}
