/**
 * Domain vocabulary and every schema that model output or API input must satisfy.
 * Model output is untrusted: it is parsed with these schemas, then checked against the
 * evidence store (citations.ts) before anything is committed.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- vocabulary

export const DOCUMENT_KINDS = ['invoice', 'packing_list', 'quote', 'survey', 'contract', 'messages', 'user_statement', 'other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  invoice: 'Invoice',
  packing_list: 'Packing list',
  quote: 'Quote / rate sheet',
  survey: 'Survey / measurement',
  contract: 'Contract / terms',
  messages: 'Messages',
  user_statement: 'Your statement',
  other: 'Other',
};

export const SOURCE_CLASSES = ['primary_document', 'official_public_report', 'reconstructed_demo', 'user_statement', 'hypothetical_demo'] as const;
export type SourceClass = (typeof SOURCE_CLASSES)[number];
export const SOURCE_CLASS_LABEL: Record<SourceClass, string> = {
  primary_document: 'Uploaded document (authenticity not verified)',
  official_public_report: 'Official public report excerpt',
  reconstructed_demo: 'Reconstructed for demonstration; not an original invoice',
  user_statement: 'User-provided statement',
  hypothetical_demo: 'Hypothetical illustration; not part of the published report',
};

export const PARSE_STATUSES = ['uploaded', 'queued', 'parsing', 'ready', 'needs_manual_review', 'failed'] as const;
export type ParseStatus = (typeof PARSE_STATUSES)[number];

export const CASE_STATUSES = ['draft', 'processing', 'needs_input', 'review_ready', 'completed', 'failed', 'archived'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const FINDING_STATUSES = ['provisional', 'supported', 'disputed', 'superseded', 'unresolved'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];
export const FINDING_CATEGORIES = ['supported_discrepancy', 'competing_explanation', 'missing_evidence'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export const SEVERITIES = ['informational', 'needs_review', 'material'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const AGENT_ROLES = ['evidence', 'billing', 'contract', 'timeline', 'case', 'drafting'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];
export const AGENT_LABEL: Record<AgentRole, string> = {
  evidence: 'Evidence Agent',
  billing: 'Billing Agent',
  contract: 'Contract Agent',
  timeline: 'Timeline Agent',
  case: 'Case Agent',
  drafting: 'Drafting Agent',
};

export const FACT_KEYS = [
  'billed_volume_cbm',
  'declared_volume_cbm',
  'measured_volume_cbm',
  'chargeable_volume_cbm',
  'rate_per_cbm',
  'billed_freight_amount',
  'invoice_total_amount',
  'minimum_chargeable_cbm',
  'minimum_charge_amount',
  'package_count',
  'package_dimensions_cm',
  'invoice_number',
  'invoice_date',
  'survey_date',
  'shipment_reference',
  'carrier_name',
  'claimant_name',
  'origin',
  'destination',
  'payment_status',
  'rounding_rule',
  'other',
] as const;
export type FactKey = (typeof FACT_KEYS)[number];
export const FACT_KEY_LABEL: Record<FactKey, string> = {
  billed_volume_cbm: 'Billed volume',
  declared_volume_cbm: 'Declared / estimated volume',
  measured_volume_cbm: 'Measured volume',
  chargeable_volume_cbm: 'Chargeable volume',
  rate_per_cbm: 'Rate per CBM',
  billed_freight_amount: 'Billed freight amount',
  invoice_total_amount: 'Invoice total',
  minimum_chargeable_cbm: 'Contractual minimum volume',
  minimum_charge_amount: 'Contractual minimum charge',
  package_count: 'Package count',
  package_dimensions_cm: 'Package dimensions (cm)',
  invoice_number: 'Invoice number',
  invoice_date: 'Invoice date',
  survey_date: 'Survey date',
  shipment_reference: 'Shipment reference',
  carrier_name: 'Freight company',
  claimant_name: 'Claimant',
  origin: 'Origin',
  destination: 'Destination',
  payment_status: 'Payment status',
  rounding_rule: 'Rounding rule',
  other: 'Other fact',
};

export const PROVENANCE = ['extracted', 'user_statement', 'user_correction', 'calculation', 'inference'] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const ASSESSMENT_CLASSES = [
  'insufficient_evidence',
  'declared_volume_conflicts_with_bill',
  'measured_volume_differs_basis_unresolved',
  'contract_term_may_explain_bill',
  'bill_consistent_with_records',
  'conflicting_evidence_needs_input',
] as const;
export type AssessmentClass = (typeof ASSESSMENT_CLASSES)[number];
export const ASSESSMENT_CLASS_LABEL: Record<AssessmentClass, string> = {
  insufficient_evidence: 'Not enough evidence yet',
  declared_volume_conflicts_with_bill: 'The packing-list estimate conflicts with the bill',
  measured_volume_differs_basis_unresolved: 'A measurement supports a volume difference; the rating basis is unresolved',
  contract_term_may_explain_bill: 'A stated contract term may explain the billed volume',
  bill_consistent_with_records: 'The bill is consistent with the records provided',
  conflicting_evidence_needs_input: 'Evidence conflicts and needs your input',
};

export const EVENT_TYPES = [
  'case.started',
  'evidence.added',
  'evidence.parsed',
  'fact.recorded',
  'fact.corrected',
  'finding.proposed',
  'finding.revised',
  'finding.challenged',
  'calculation.completed',
  'contract.interpretation',
  'timeline.updated',
  'question.raised',
  'question.answered',
  'assessment.updated',
  'draft.requested',
  'draft.updated',
  'agent.started',
  'agent.completed',
  'agent.failed',
  'agent.result_discarded',
  'run.queued',
  'run.started',
  'run.completed',
  'run.cancelled',
  'run.failed',
  'mozaik.loop.started',
  'mozaik.inference.started',
  'mozaik.inference.completed',
  'mozaik.function_call.started',
  'mozaik.function_call.completed',
  'mozaik.model.answer',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const LETTER_SECTION_IDS = [
  'sender',
  'recipient',
  'subject',
  'concern',
  'comparison',
  'uncertainty',
  'requests',
  'response',
  'annex',
  'closing',
] as const;
export type LetterSectionId = (typeof LETTER_SECTION_IDS)[number];
export const LETTER_SECTION_TITLE: Record<LetterSectionId, string> = {
  sender: 'Sender',
  recipient: 'Recipient and shipment reference',
  subject: 'Subject',
  concern: 'Why we are writing',
  comparison: 'Comparison of billed and measured volume',
  uncertainty: 'What remains uncertain',
  requests: 'Specific requests',
  response: 'Response requested',
  annex: 'Records referred to',
  closing: 'Closing',
};

// ---------------------------------------------------------------- shared pieces

const ref = z.string().min(1).max(40);
const refs = z.array(ref).max(40);
const text = (max: number) => z.string().min(1).max(max);

export const QuestionProposal = z.object({
  audience: z.enum(['user', 'carrier']),
  prompt: text(400),
  reason: text(400),
});
export type QuestionProposal = z.infer<typeof QuestionProposal>;

export const FindingProposal = z.object({
  topic: text(80),
  title: text(200),
  category: z.enum(FINDING_CATEGORIES),
  severity: z.enum(SEVERITIES),
  status: z.enum(['provisional', 'supported', 'disputed', 'unresolved']),
  explanation: text(1200),
  factRefs: refs,
  calcRefs: refs,
  spanRefs: refs,
  basis: z.enum(['sourced', 'inference']),
});
export type FindingProposal = z.infer<typeof FindingProposal>;

// ---------------------------------------------------------------- agent outputs

export const EvidenceOutput = z.object({
  facts: z
    .array(
      z.object({
        key: z.enum(FACT_KEYS),
        subject: z.string().max(80).nullable(),
        value: text(300),
        unit: z.string().max(20).nullable(),
        currency: z.string().max(3).nullable(),
        spanRefs: refs.min(1),
        quote: text(500),
        confidence: z.enum(['high', 'medium', 'low']),
        notes: z.string().max(300).nullable(),
      }),
    )
    .max(80),
  ambiguities: z.array(z.object({ description: text(400), spanRefs: refs })).max(20),
  questions: z.array(QuestionProposal).max(8),
});
export type EvidenceOutput = z.infer<typeof EvidenceOutput>;

export const COMPARISON_TOPICS = ['billed_vs_declared', 'billed_vs_measured', 'billed_vs_contract_term'] as const;
export type ComparisonTopic = (typeof COMPARISON_TOPICS)[number];

export const BillingOutput = z.object({
  comparisons: z
    .array(
      z.object({
        topic: z.enum(COMPARISON_TOPICS),
        label: text(160),
        billedVolumeFact: ref.nullable(),
        comparisonVolumeFact: ref.nullable(),
        rateFact: ref.nullable(),
        contractMinimumFact: ref.nullable(),
        note: z.string().max(400).nullable(),
      }),
    )
    .max(6),
  packageSums: z
    .array(
      z.object({
        label: text(160),
        packageFactRefs: refs.min(1),
        reportedVolumeFact: ref.nullable(),
      }),
    )
    .max(3),
  missingVariables: z.array(z.object({ variable: text(120), reason: text(300) })).max(10),
  summary: text(600),
});
export type BillingOutput = z.infer<typeof BillingOutput>;

export const ContractOutput = z.object({
  termsStatus: z.enum(['terms_found', 'terms_missing', 'conflicting']),
  clauses: z
    .array(
      z.object({
        kind: z.enum(['minimum_chargeable_volume', 'rounding', 'rate', 'volume_basis', 'responsible_party', 'other']),
        quote: text(500),
        spanRefs: refs.min(1),
        minimumCbm: z.string().max(20).nullable(),
        roundUpToCbm: z.string().max(20).nullable(),
        rate: z.string().max(30).nullable(),
        currency: z.string().max(3).nullable(),
        interpretation: text(400),
      }),
    )
    .max(12),
  carrierQuestions: z.array(QuestionProposal).max(6),
  challenges: z.array(z.object({ targetTopic: text(80), reason: text(400), spanRefs: refs })).max(6),
  summary: text(600),
});
export type ContractOutput = z.infer<typeof ContractOutput>;

export const TimelineOutput = z.object({
  events: z
    .array(
      z.object({
        date: z.string().max(40).nullable(),
        datePrecision: z.enum(['day', 'month', 'year', 'unknown']),
        actor: z.string().max(120).nullable(),
        description: text(300),
        spanRefs: refs.min(1),
      }),
    )
    .max(40),
  gaps: z.array(text(300)).max(10),
  conflicts: z.array(z.object({ description: text(300), spanRefs: refs })).max(6),
  summary: text(500),
});
export type TimelineOutput = z.infer<typeof TimelineOutput>;

export const CaseOutput = z.object({
  classification: z.enum(ASSESSMENT_CLASSES),
  headline: text(300),
  summary: text(1000),
  strongestCounterExplanation: text(600),
  changeReason: z.string().max(800).nullable(),
  findings: z.array(FindingProposal).max(10),
  findingOps: z
    .array(
      z.object({
        ref,
        action: z.enum(['confirm', 'mark_disputed', 'withdraw']),
        reason: text(400),
      }),
    )
    .max(10),
  questions: z.array(QuestionProposal).max(8),
  nextAction: text(300),
  readiness: z.enum(['needs_input', 'review_ready']),
});
export type CaseOutput = z.infer<typeof CaseOutput>;

export const DRAFT_BODY_SECTIONS = ['concern', 'comparison', 'uncertainty', 'requests'] as const;
export const DraftOutput = z.object({
  sections: z
    .array(
      z.object({
        id: z.enum(DRAFT_BODY_SECTIONS),
        text: text(2000),
        refs: refs.min(1),
      }),
    )
    .min(1)
    .max(4),
  changeSummary: text(500),
});
export type DraftOutput = z.infer<typeof DraftOutput>;

// ---------------------------------------------------------------- event envelope

export const CaseEventEnvelope = z.object({
  id: z.string(),
  caseId: z.string(),
  runId: z.string().nullable(),
  type: z.enum(EVENT_TYPES),
  producer: z.string(),
  occurredAt: z.string(),
  causationId: z.string().nullable(),
  correlationId: z.string().nullable(),
  evidenceRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string(),
  payload: z.record(z.string(), z.unknown()),
});
export type CaseEventEnvelope = z.infer<typeof CaseEventEnvelope>;

/** Minimal per-type payload validation applied before an event is persisted. */
export const EVENT_PAYLOAD: Partial<Record<EventType, z.ZodType>> = {
  'case.started': z.object({ documentRefs: z.array(z.string()), targeted: z.array(z.string()).optional() }),
  'evidence.added': z.object({ documentRefs: z.array(z.string()).min(1), reason: z.string() }),
  'evidence.parsed': z.object({ documentRef: z.string(), status: z.string() }),
  'fact.recorded': z.object({ factRefs: z.array(z.string()), keys: z.array(z.string()), by: z.string() }),
  'fact.corrected': z.object({ factRef: z.string(), replacesRef: z.string(), key: z.string() }),
  'calculation.completed': z.object({ calcRefs: z.array(z.string()), topics: z.array(z.string()) }),
  'contract.interpretation': z.object({ termsStatus: z.string(), affectsCalculation: z.boolean(), clauseFactRefs: z.array(z.string()) }),
  'timeline.updated': z.object({ eventRefs: z.array(z.string()) }),
  'finding.challenged': z.object({ findingRef: z.string(), reason: z.string() }),
  'question.answered': z.object({ questionRef: z.string(), factRef: z.string().nullable() }),
  'assessment.updated': z.object({ version: z.number().int(), classification: z.string(), changed: z.boolean() }),
  'draft.updated': z.object({ version: z.number().int(), proposed: z.boolean() }),
  'agent.failed': z.object({ role: z.string(), code: z.string(), message: z.string() }),
};

// ---------------------------------------------------------------- API input

export const SHIPMENT_CLASSES = ['LCL', 'FCL', 'air', 'other', 'unknown'] as const;

export const CreateCaseInput = z.object({
  name: z.string().trim().min(1).max(160),
  claimant: z.string().trim().max(160).optional().default(''),
  counterparty: z.string().trim().max(160).optional().default(''),
  origin: z.string().trim().max(120).optional().default(''),
  destination: z.string().trim().max(120).optional().default(''),
  shipmentClass: z.enum(SHIPMENT_CLASSES).optional().default('unknown'),
  currency: z.string().trim().toUpperCase().length(3).optional().default('NGN'),
  billedAmount: z.string().trim().max(30).optional().default(''),
  quoteCurrency: z.string().trim().max(3).optional().default(''),
  concern: z.string().trim().max(4000).optional().default(''),
});
export type CreateCaseInput = z.infer<typeof CreateCaseInput>;

export const FactCorrectionInput = z.object({
  value: z.string().trim().min(1).max(300),
  unit: z.string().trim().max(20).nullable().optional(),
  note: z.string().trim().max(500).optional().default(''),
  expectedRevision: z.number().int().optional(),
});

export const ChallengeInput = z.object({
  reason: z.string().trim().min(5).max(1500),
  expectedRevision: z.number().int().optional(),
});

export const AnswerInput = z.object({
  answer: z.string().trim().min(1).max(2000),
  dontKnow: z.boolean().optional().default(false),
});

export const LetterPatchInput = z.object({
  baseVersion: z.number().int(),
  sections: z.record(z.string(), z.string().max(8000)),
});

export const ReconcileInput = z.object({
  proposalVersion: z.number().int(),
  decisions: z.record(z.string(), z.enum(['accept', 'keep'])),
});

export const AuthInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().max(120).optional().default(''),
});
