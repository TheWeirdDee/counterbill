# Submission text (NTP Novi Sad Hackathon 2026, Freestyle track)

Everything below describes behaviour that exists in this repository. Where something is untested or unavailable it says so.

## Project name

Counterbill

## One-line description

When a freight bill doesn't match the evidence, Counterbill's concurrent Mozaik agents compare your records, recalculate the difference, say what is still unproven, and revise a complaint letter, with the reason shown, every time you add a document.

## Description

Small importers get freight bills that don't match their quote, packing list or measurements, and sorting out why is slow and easy to get wrong. A volume difference isn't automatically an overcharge: the declared, measured, billed and chargeable volume are four different things, and the carrier's contract terms may legitimately change the answer.

Counterbill takes the documents (PDF, text, .eml; images need figures typed in), and six Mozaik agents work on one case:

- **Evidence** records facts with a citation and a verbatim quote for each.
- **Billing** chooses which comparisons the facts support; deterministic code (exact decimals) produces every amount.
- **Contract** looks for chargeable-volume terms and says "terms missing" when none exist.
- **Timeline** reconstructs dated events and never guesses a date.
- **Case** weighs everything, looks for the strongest contrary explanation, and revises earlier findings (the old reading is kept as superseded).
- **Drafting** writes the letter body; user-edited paragraphs are never overwritten, agent changes arrive as proposals.

The defining behaviour: add evidence and only the affected agents reassess. The case, the numbers and the letter change, and the screen says what changed and why. Everything is cited, nothing is sent for you, and the letter is non-accusatory by construction (figures and wording are validated before they are saved).

The public samples are built from two published Nigerian Shippers' Council reports (verified against the pages, see `docs/SOURCE_VERIFICATION.md`). Documents that are not public are reconstructed and labelled "Reconstructed for demonstration" in the list, the viewer, the findings and the exports.

## How the agents run concurrently (explanation for the judges)

Source: `src/mozaik/`. One investigation run = one worker **process** (`workers/run-child.ts`, spawned by `workers/supervisor.ts`) that calls `initializeRuntime` once, so each case has its own `RuntimeState`.

1. **Real concurrency.** `case.started` is published with `sendEvent`. Each of the Evidence, Billing, Contract and Timeline agents has a `SituationHandler` whose specification matches that event; each processor calls `runLoop`, which returns immediately. Four Mozaik loops, each with its own `loopId`, therefore run at the same time. The first-wave start times differ by a few milliseconds; the UI's concurrency view and the trace show recorded start/finish times and the overlap computed from them.
2. **Shared state with ownership.** `CounterbillState extends RuntimeState` carries the case, revision, facts, findings and per-agent bookkeeping. PostgreSQL is the source of truth, and every write is a transaction that first checks the case's evidence revision. Billing owns `volume:*` findings; only the Case Agent writes `interpretation:*`.
3. **Reaction, not orchestration.** Agents publish application events (`fact.recorded`, `calculation.completed`, `contract.interpretation`, `timeline.updated`, `assessment.updated`, `draft.updated`, ...) with `sendEvent`; other agents' handlers react. Billing wakes on `fact.recorded` for billing keys, and again on a `contract.interpretation` that changes the chargeable volume. The Case Agent coalesces bursts with a 1.8 s stabilisation window, and Drafting waits for `assessment.updated`.
4. **Targeted reassessment.** A new document starts a run with `evidence.added`, not `case.started`. A packing-list-only update wakes neither Contract nor Timeline (tested).
5. **Safety.** Events are persisted before they are published (idempotency key per event); duplicate events are dropped. A model result computed for an older evidence revision is discarded. A superseded run is cancelled. Retries are bounded (up to three attempts per task, a per-agent pass cap per run, a per-run model-call budget); a failed agent leaves partial results and a "retry failed agents" action.
6. **Observation.** A `trace` participant subscribes to Mozaik's own `message_received.started`, `inference.started/completed`, `function_call.*` and `model.answer` events and stores a sanitised record (agent, `loopId`, timestamps, token counts, tool names; no prompts or answers).

## What has and hasn't been verified

- Verified with automated tests (see README → Tests): the domain arithmetic, citation checks, the whole multi-agent flow in real worker processes with a deterministic stand-in for the model (**test mode**), failure and recovery paths, access control, the browser journeys and responsive layouts.
- The default test suite never calls a model provider. The live provider path is also exercised against a local protocol-faithful fake of the OpenAI Responses API.
- **Real-model runs were performed on Google Gemini's free tier** (`gemini-3.5-flash-lite` through Mozaik): both examples, the survey revision and the contract-minimum revision, and again on the redesigned app. Results, the failures found along the way and the trace files are in `docs/LIVE_RESULTS.md` and `docs/traces/`. Traces hold runtime events, timings, token counts and validation outcomes, not prompts or model answers. It is a small number of runs on one small model, not a benchmark.
- Hosting: a Render Free + Neon Free configuration is prepared and the container was exercised locally under the Render Free limits (`docs/DEPLOY_RENDER.md`). It has not yet been run on a hosted URL.
