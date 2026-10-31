# Implementation decisions and deviations from the PRD

Material choices, and every place the build differs from `COUNTERBILL_PRD.md`.

## Architecture

| PRD | What was built | Why |
|---|---|---|
| `apps/web` + `packages/*` workspace | One Next.js package: `src/domain`, `src/mozaik`, `src/db`, `src/server`, `src/docs`, `src/exports`, `workers/` | A workspace adds build plumbing with no benefit for one deployable. Module boundaries are the same. |
| Signed upload URLs to object storage (`/documents/upload-url`, `/complete`) | Authenticated multipart `POST /api/cases/:id/documents`; bytes stored in PostgreSQL (`document_blobs`) | The database is durable and private, needs no extra service, and ownership is checked by the same route. A Supabase/S3 driver is **not implemented**; the 15 MB file cap keeps `bytea` practical. |
| Supabase auth / RLS | Own email+password accounts (scrypt), httpOnly session cookie, server-side ownership checks on every case route (404 for non-owners) | No external dependency for judges. There is no row-level security: isolation is enforced in the API layer and tested. |
| `/demo/[caseSlug]` is the live investigation | `/demo/[slug]` is the disclosure + launcher; the live workspace is `/demo/[slug]/[caseId]` | A visitor may start several fresh runs; each is its own case. |
| `/api/demo/runs/:runId/events` and `/trace` | Implemented as aliases of `/api/cases/:id/events` and `/trace` | Same access check (the visitor's own browser). |
| Redis/BullMQ queue | PostgreSQL work queue: `investigation_runs` with leases, `FOR UPDATE SKIP LOCKED`, one running run per case enforced by a partial unique index | Fewer moving parts; durable by construction. |
| One worker per run | `workers/supervisor.ts` claims runs and spawns **one child process per run** (`workers/run-child.ts`); Mozaik `initializeRuntime` is called once in that process | As specified. Max 3 concurrent runs by default (`MAX_CONCURRENT_RUNS`). |
| Embedded dev DB not specified | `pnpm db:start` runs a real PostgreSQL via the `embedded-postgres` package (no Docker); `docker-compose.yml` is the alternative | Judges without Docker can still run it. |
| PDF library "a PDF export library" | `pdf-lib` + embedded Noto Sans (Latin and Latin Extended) | The ₦ sign needs an embedded font; standard PDF fonts do not contain it. |
| Optional ZIP case pack | Not built | Marked optional in the PRD. The complaint PDF, evidence-summary PDF and a CSV are downloadable separately; originals are never exported. |

## Evidence handling

- **OCR is not configured.** Images (PNG/JPG) and scanned PDFs are stored and marked "needs manual review"; the user enters key figures by hand, recorded as user statements. The PRD allows OCR "if configured".
- **Extraction is model-based.** The Evidence Agent returns structured facts; the server then verifies span identifiers exist and that each quote occurs verbatim in the cited span before storing anything.
- **Facts are immutable.** A correction creates a new fact (`provenance: user_correction`, `corrects_ref`) and supersedes the old one.
- **User statements are documents** (`kind: user_statement`) so they have citable spans like everything else.
- **Identifiers are case-scoped short refs** (`D3`, `D3-p1-s2`, `F7`, `C2`, `FN4`, `Q1`) so a model can copy them exactly. The PRD's `sourceId/pageNumber/spanId` is represented by the `D#-p#-s#` form.

## Agents and coordination

- `Case` reacts to `calculation.completed`, `finding.proposed|revised`, `contract.interpretation`, `timeline.updated`, `finding.challenged`, `fact.corrected` and `question.answered`. It does **not** react to the Evidence Agent's `fact.recorded`, because Billing's calculation follows milliseconds-to-seconds later and would trigger a second, redundant assessment. Bursts are coalesced by a 1.8 s stabilisation window (documented in `src/mozaik/agents/case.ts`).
- `Timeline` wakes on `case.started`, and afterwards only when newly recorded facts carry dates. `Contract` wakes on new quotes/contracts/messages/surveys/invoices or a user challenge. A packing-list-only update wakes neither (tested).
- `Billing` and `Case` skip a pass when the inputs they depend on have not changed since their last pass (input signatures).
- One loop per agent at a time (a per-role queue); loops of different agents overlap freely.
- Only the Case Agent writes `interpretation:*` findings. Billing owns `volume:*`, `package_*` and `missing:*` findings. This prevents the two from overwriting each other's revisions.
- **Calculations are never made by the model.** The model chooses which facts to compare; `src/domain/case-rules.ts` computes with exact decimals. The model's prose is checked: any ₦ or CBM figure that is not in a stored fact or calculation is rejected, as is accusatory/entitlement language.
- `runLoop` is fire-and-forget and Mozaik does not surface a failed model call anywhere, so the inference runner is wrapped (`src/mozaik/instrumented-runner.ts`) to report failures to the owning task and enforce a per-run call budget.
- Mozaik Cloud telemetry is disabled in workers (credentials stripped) so case text cannot be forwarded by the SDK.

## Test mode

`COUNTERBILL_INFERENCE=test` plugs a deterministic scripted runner into the same Mozaik runtime as the model. Everything else (agents, events, validation, database, worker process) is real. Runs are labelled **TEST MODE** in the UI, trace, evidence summary and exports. It is never selected implicitly: with no key and no explicit test flag, starting an investigation returns a setup error.

## Gemini free tier (live model)

| Topic | Decision |
|---|---|
| Provider and model | Gemini via Mozaik's `GeminiGenerateContent`; credential `GEMINI_API_KEY` (the adapter reads exactly that name). Default `gemini-3.5-flash-lite`: the fastest of the four Gemini models Mozaik 4.2.0 supports that the author's free tier serves. `gemini-3.1-pro-preview` returned HTTP 429 with a ~21 h retry delay (no free quota); `gemini-3.8-flash` was slow and intermittently 503. Chosen by probing (`pnpm gemini:models`), not by assumption. |
| Key handling | Server-side `.env`, git-ignored. A lower-case `gemini_api_key` is accepted and mapped to the upper-case name so it also works on case-sensitive hosts. |
| Thinking level | `low` by default for Gemini (`MOZAIK_REASONING_EFFORT` to change). |
| Schema | Mozaik sends the schema as Gemini's `responseSchema`, an OpenAPI-style subset: Counterbill strips `additionalProperties` and turns `anyOf: [X, null]` into `nullable`. Zod validates the real output regardless. |
| Tools | Not offered to Gemini. Mozaik 4.2.0 drops Gemini 3's `thoughtSignature` on function calls, and the provider then rejects the follow-up turn (HTTP 400, recorded in `docs/traces`). The tools were optional; arithmetic is deterministic server code. |
| Rate limits | Calls are paced (default 10/minute, counted in PostgreSQL so every run and worker shares one key's quota; loops still run concurrently). 429/5xx are retried at most 3 times, waiting the delay the provider gives (≤ 75 s); a longer delay, or a per-day limit, is reported at once as "quota exhausted", and the run keeps its partial results. Each wait is a stored, visible `agent.rate_limited` event. Never a fallback to another or paid model, never canned output. |
| Validation instead of trust | The real model's mistakes shaped these gates: per-fact citation checks (bad facts dropped and counted, an answer with none is rejected); a deterministic guard that the assessment classification is supported by the calculations; Billing-owned finding topics and unusable finding operations are ignored rather than fatal; empty Billing slots become "missing inputs"; near-duplicate questions are merged and answered ones can be closed; up to 3 attempts per task with the reasons fed back. |

## Not done / out of scope here

- No hosted deployment (needs an account the build could not create).
- Analytics events (PRD §15) are not collected; nothing is sent anywhere.
- XLSX export; CSV is provided.
- Shareable redacted read-only case link.
- Third sample (demurrage): no verifiable public source (see `docs/SOURCE_VERIFICATION.md`).
