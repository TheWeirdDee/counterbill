-- Counterbill schema. PostgreSQL 15+.
-- Child entities are keyed by (case_id, ref). `ref` is the short, case-scoped identifier (D1, F7, C2, FN3, Q1)
-- that agents cite and the UI displays; every API read verifies case ownership before touching them.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  display_name text not null default '',
  organization_name text not null default '',
  contact_details text not null default '',
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index sessions_user_idx on sessions(user_id);

create table cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) on delete cascade,
  is_demo boolean not null default false,
  demo_slug text,
  demo_token_hash text,
  name text not null,
  claimant text not null default '',
  counterparty text not null default '',
  origin text not null default '',
  destination text not null default '',
  shipment_class text not null default 'unknown',
  currency text not null default 'NGN',
  billed_amount text not null default '',
  quote_currency text not null default '',
  concern text not null default '',
  status text not null default 'draft',
  archived boolean not null default false,
  revision integer not null default 0,
  sample_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_demo and demo_token_hash is not null) or (not is_demo and owner_id is not null))
);
create index cases_owner_idx on cases(owner_id, updated_at desc);
create index cases_status_idx on cases(status);

create table case_counters (
  case_id uuid not null references cases(id) on delete cascade,
  prefix text not null,
  n integer not null default 0,
  primary key (case_id, prefix)
);

create table documents (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  id uuid not null unique default gen_random_uuid(),
  kind text not null default 'other',
  kind_set_by_user boolean not null default false,
  source_class text not null default 'primary_document',
  source_label text,
  source_url text,
  source_published text,
  original_filename text not null,
  mime text not null default 'application/octet-stream',
  size_bytes integer not null default 0,
  sha256 text not null default '',
  version integer not null default 1,
  supersedes_ref text,
  parse_status text not null default 'uploaded',
  parse_error text,
  extraction_method text,
  ocr boolean not null default false,
  parse_confidence numeric,
  page_count integer not null default 0,
  storage_key text,
  added_at_revision integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (case_id, ref)
);
create index documents_status_idx on documents(parse_status);
create index documents_sha_idx on documents(case_id, sha256);

create table document_blobs (
  storage_key text primary key,
  case_id uuid not null references cases(id) on delete cascade,
  bytes bytea not null,
  created_at timestamptz not null default now()
);
create index document_blobs_case_idx on document_blobs(case_id);

create table spans (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  document_ref text not null,
  page integer not null,
  idx integer not null,
  start_offset integer not null,
  end_offset integer not null,
  text text not null,
  primary key (case_id, ref),
  foreign key (case_id, document_ref) references documents(case_id, ref) on delete cascade
);
create index spans_doc_idx on spans(case_id, document_ref, page, idx);

create table facts (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  key text not null,
  subject text,
  value text not null,
  unit text,
  currency text,
  span_refs text[] not null default '{}',
  quote text,
  provenance text not null,
  source_class text,
  status text not null default 'active',
  confidence text,
  notes text,
  corrects_ref text,
  correction_note text,
  produced_by text not null,
  run_id uuid,
  evidence_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (case_id, ref)
);
create index facts_key_idx on facts(case_id, key, status);

create table calculations (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  topic text not null,
  kind text not null,
  label text not null,
  formula text not null,
  input_fact_refs text[] not null default '{}',
  assumptions jsonb not null default '[]',
  output text not null,
  unit text not null,
  display text not null,
  caveat text,
  status text not null default 'current',
  supersedes_ref text,
  input_hash text not null,
  produced_by text not null,
  run_id uuid,
  evidence_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (case_id, ref)
);
create index calculations_topic_idx on calculations(case_id, topic, status);

create table findings (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  topic text not null,
  title text not null,
  category text not null,
  status text not null,
  severity text not null,
  explanation text not null,
  fact_refs text[] not null default '{}',
  calc_refs text[] not null default '{}',
  span_refs text[] not null default '{}',
  basis text not null default 'sourced',
  supersedes_ref text,
  superseded_by_ref text,
  change_reason text,
  content_hash text not null,
  produced_by text not null,
  run_id uuid,
  evidence_revision integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (case_id, ref)
);
create index findings_topic_idx on findings(case_id, topic, status);

create table questions (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  audience text not null,
  prompt text not null,
  reason text not null,
  status text not null default 'open',
  answer_fact_ref text,
  dedupe_key text not null,
  raised_by text not null,
  run_id uuid,
  evidence_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (case_id, ref),
  unique (case_id, dedupe_key)
);

create table timeline_events (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  occurred_on text,
  date_precision text not null,
  actor text,
  description text not null,
  span_refs text[] not null default '{}',
  kind text not null default 'event',
  status text not null default 'active',
  dedupe_key text not null,
  run_id uuid,
  evidence_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (case_id, ref),
  unique (case_id, dedupe_key)
);

create table interpretations (
  case_id uuid not null references cases(id) on delete cascade,
  ref text not null,
  terms_status text not null,
  summary text not null,
  clause_fact_refs text[] not null default '{}',
  challenges jsonb not null default '[]',
  affects_calculation boolean not null default false,
  status text not null default 'current',
  produced_by text not null,
  run_id uuid,
  evidence_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (case_id, ref)
);

create table assessments (
  case_id uuid not null references cases(id) on delete cascade,
  version integer not null,
  classification text not null,
  headline text not null,
  summary text not null,
  strongest_counter text not null,
  change_reason text,
  change_diff jsonb not null default '{}',
  next_action text not null,
  readiness text not null,
  run_id uuid,
  evidence_revision integer not null,
  created_at timestamptz not null default now(),
  primary key (case_id, version)
);

create table investigation_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  kind text not null default 'start',
  status text not null default 'queued',
  evidence_revision integer not null,
  trigger jsonb not null default '{}',
  targeted_agents text[] not null default '{}',
  inference_mode text not null default 'live',
  model text,
  worker_id text,
  lease_expires_at timestamptz,
  cancel_requested boolean not null default false,
  cancel_reason text,
  parent_run_id uuid,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  model_calls integer not null default 0
);
create index runs_case_idx on investigation_runs(case_id, queued_at desc);
create index runs_status_idx on investigation_runs(status, queued_at);
-- At most one active run per case.
create unique index runs_one_active_per_case on investigation_runs(case_id) where status = 'running';

create table agent_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references investigation_runs(id) on delete cascade,
  case_id uuid not null references cases(id) on delete cascade,
  agent_role text not null,
  task_label text not null,
  mozaik_agent_id text not null,
  mozaik_loop_id text,
  status text not null default 'running',
  attempt integer not null default 1,
  trigger_event_id text,
  evidence_revision integer not null,
  model_name text,
  input_tokens integer,
  output_tokens integer,
  result_summary text,
  error text,
  started_at timestamptz not null default now(),
  inference_started_at timestamptz,
  inference_finished_at timestamptz,
  finished_at timestamptz
);
create index agent_runs_run_idx on agent_runs(run_id, started_at);

create table case_events (
  seq bigserial primary key,
  id uuid not null unique default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  run_id uuid,
  type text not null,
  producer text not null,
  payload jsonb not null default '{}',
  causation_id text,
  correlation_id text,
  evidence_revision integer not null default 0,
  idempotency_key text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  unique (idempotency_key)
);
create index case_events_case_idx on case_events(case_id, seq);
create index case_events_run_idx on case_events(run_id, seq);

create table letter_drafts (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  version integer not null,
  status text not null,
  sections jsonb not null,
  evidence_revision integer not null,
  base_version integer,
  created_by text not null,
  change_summary text,
  run_id uuid,
  created_at timestamptz not null default now(),
  unique (case_id, version)
);
create index letter_drafts_case_idx on letter_drafts(case_id, version desc);

create table exports (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references cases(id) on delete cascade,
  kind text not null,
  filename text not null,
  draft_version integer not null,
  evidence_revision integer not null,
  storage_key text not null,
  size_bytes integer not null,
  reviewed boolean not null default false,
  created_at timestamptz not null default now()
);
create index exports_case_idx on exports(case_id, created_at desc);

create table rate_limits (
  key text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_start)
);
