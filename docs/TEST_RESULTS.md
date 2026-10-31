# Test results

Run on 31 October 2026 on the development machine: Windows 11, Node 24.13, pnpm 11.5, embedded PostgreSQL 18, Chromium via
Playwright 1.64. Outcomes below are copied from the logs of those runs. **What each layer uses in place of a language model is
stated per row; no run used a real model.**

## Summary

| Layer | Command | Outcome | Model used |
|---|---|---|---|
| Types | `pnpm typecheck` (TypeScript 6.0) | exit 0, no errors | n/a |
| Lint | `pnpm lint` (ESLint, Next + TypeScript rules) | 0 errors, 0 warnings | n/a |
| Unit | `pnpm test` | 34 passed (2 files) | n/a |
| Integration | `pnpm test:integration` | 19 passed (3 files): `story` 9, `resilience` 9, `live-path` 1 | `story`, `resilience`: **test mode** runner. `live-path`: **local fake of the OpenAI Responses API** |
| Browser e2e | `pnpm test:e2e` (production build served on :3100) | 19 passed | **test mode** runner |
| Build | `pnpm build` (Next.js 16.4.3, Turbopack) | success | n/a |

`pnpm exec vitest run` (unit + integration together): **5 files, 53 tests passed**, 141 s.

The final full browser run was 18 passed / 1 failed; the failure was a test race (it edited the letter while the Drafting
Agent was still saving a newer version, so the conditional write was correctly refused). The test now waits for the letter
to catch up, and that test passed on re-run (55 s). Earlier runs surfaced real defects that were fixed (see "What the tests found").

## What the integration tests prove (real worker processes, real Mozaik runtime, real PostgreSQL)

`tests/integration/story.test.ts`
- The four first-wave agents start within 600 ms of each other off one `case.started`, have four distinct Mozaik `loopId`s, and at least three pairs overlap in recorded start/finish time; at least two pairs also overlap in the **inference** spans taken from Mozaik's own `inference.started/completed` events.
- First pass: ₦298,100 comparison against the packing-list estimate; Billing first reports missing inputs (it does not wait for Evidence) and those findings are later superseded.
- Every stored fact cites span ids that exist.
- Survey evidence: assessment v2; charges 596,200 / 406,500 / 189,700 and package sum 0.757348 exactly; the earlier finding is superseded and linked both ways; the letter draft is revised, contains ₦189,700, and carries a change summary; the event order is `evidence.added → fact.recorded → calculation.completed → assessment.updated → draft.updated`, with no `case.started` (a reassessment is not a restart).
- Re-adding evidence that is already recorded creates no new facts, findings, calculations, drafts or assessments.
- A packing-list-only update wakes the Evidence Agent but not Contract or Timeline.
- A stated 1.00 CBM minimum: chargeable volume 1.00, ₦54,200 left unexplained, classification `contract_term_may_explain_bill`, interpretation `terms_found`, letter wording asks rather than alleges, superseded readings preserved.
- A user correction: stale `expectedRevision` is refused (409); the correction is a new `user_correction` fact, the original stays (superseded, value intact), the case is reassessed and the difference becomes ₦162,600 (1.10 − 0.80 = 0.30 CBM × 542,000).
- Exports: both PDFs open, carry the ₦ amounts, "reconstructed for demonstration", the review footer, the 0.757348 CBM sum, the superseded-readings section, and **TEST MODE**.

`tests/integration/resilience.test.ts`
- Malformed model JSON: first attempt fails visibly (`invalid_model_output`), retry succeeds, nothing half-written.
- Citation to a non-existent source (`D9-p9-s9`): rejected with that reason, none of it stored.
- Prompt injection inside an uploaded document: kept as an ordinary passage, never turned into a fact; a stand-in model that *obeys* it ("refund approved … guaranteed refund") is rejected by the language gate, the retry succeeds, and no finding or letter text contains entitlement language.
- Agent failure: run is `partial`, other agents' facts kept, nothing invented; the Case Agent reports "not enough evidence yet"; **retry** runs only the failed agent, adds no duplicate facts, and completes.
- Stale result: evidence revision bumped while Billing is mid-call → every Billing result is `discarded`, no calculation is written, an `agent.result_discarded` event is stored.
- Cancellation: the worker exits cleanly, the run is `cancelled`, nothing late is written.
- Crashed worker: an expired lease is reaped into `failed` / `worker_lost` with a `run.failed` event, and the case can be retried.
- Missing credentials: `inferenceReadiness()` is not ready; `startInvestigation` fails with `missing_api_key` (HTTP 503); a worker given a queued run fails it with `missing_api_key` naming the variable and creates no agent runs.
- Starting twice returns the same run; an event idempotency key stores one event.

`tests/integration/live-path.test.ts` (fake provider, **not a real model**)
- The worker, with `OPENAI_API_KEY` set and test mode off, runs the whole investigation through Mozaik's `DefaultInferenceRunner` and `OpenAIResponses` endpoint against a local HTTP server that speaks the Responses API shape. The run is recorded as `live`, model `gpt-5.5`.
- Every request used `text.format = json_schema`, `strict: true`, a valid strict schema (all properties required, `additionalProperties: false`), and the agent's developer message with the untrusted-data policy.
- Billing was offered `calculate_cbm` and `calculate_charge`; the fake returned a `function_call`, Mozaik ran the tool, and the output was fed back; the tool appears in the trace.
- Token usage from the provider response is stored; the API key appears in no stored event and no process output.

## What the browser tests prove (`tests/e2e/*.spec.ts`, Chromium)

Sample → live investigation → add survey → revised finding and letter → citation opens the highlighted passage → superseded reading shown → letter edit persists across reload and is marked unverified → PDF download needs the review acknowledgement and contains ₦189,700 / ₦596,200 / ₦406,500, the user's own words, the disclosure and no entitlement language; evidence-summary PDF contains 0.757348. Hypothetical rate sheet changes the reading and the letter. Missing evidence gives "not enough evidence" with questions and "Not yet established" figures. Private case: sign-up → wizard → upload (unsupported `.exe` refused with a message) → parse → start → correct a fact → numbers change (₦216,800) → export; **a second account gets 404 on the case, documents, file preview, letter, trace, exports and start, and sees no content; a signed-out visitor is sent to login (401 on the API)**. Stream cut for 5 s mid-run → UI converges and the event list equals the stored events exactly once each. Refresh mid-investigation. Public report site blocked → the sample still works, with the cached excerpt labelled. Landing content, bad credentials, settings redirect, delete-everything. Widths 320, 375, 390, 768, 1024, 1280: no horizontal overflow on landing, samples, launcher, login and all six workspace tabs; icon-only hamburger with an accessible name and `aria-expanded`; no marketing footer on the workspace; skip link first; visible focus; Esc closes the document dialog and returns focus; light/dark/system themes persist; reduced motion removes transitions.

## What the tests found (and what was changed)

1. A signature race: a fast Billing pass recorded its "inputs seen" after the facts had changed, so the follow-up pass was skipped. Found by the instant fake provider, fixed (signature captured when the pass starts) — covered by `live-path`.
2. A letter could be exported while the Drafting Agent was still revising it. Exports are now refused server-side (409 `run_in_progress`) and disabled in the UI during an investigation; the evidence summary also warns if it is ever built from a stale draft.
3. The Evidence Agent classified `rate_per_cbm` as a volume (key ends `_cbm`), which would have stripped the rate's currency semantics and made the letter's figure gate reject a valid sentence.
4. Overflow at 320 px (long chips, a fixed two-column timeline grid) — fixed.
5. The test runner's drafting script ignored the assessment classification (test-double only).

## What was not tested

- Any real language model; the accuracy of extraction on real documents; latency under a real provider.
- Real PDFs and scanned images beyond type/signature validation and the "needs manual review" path (no OCR).
- A hosted deployment, a restart of a hosted deployment, or SSE through a production proxy.
- Safari/Firefox; a screen reader (ARIA roles, live regions and focus order were checked by assertion only).
