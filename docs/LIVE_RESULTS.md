# Live results: real Gemini (free tier) through Mozaik

Recorded on 31 October 2026 on the development machine. Every figure below comes from a stored trace in
[`docs/traces/`](traces/) (downloaded from `/api/cases/:id/trace`, so they contain agents, Mozaik loop ids, timestamps,
token counts and events, but no prompts, document text, model answers or keys) or from the case state the app stored.
**No billing was enabled and nothing was paid for**: every call was served on the free tier.

This is a small number of runs on one small model. It shows the product works end to end against a real model and records how it
failed along the way; it is not a benchmark and says nothing about accuracy on real customer documents.

## Configuration

| | |
|---|---|
| Provider / adapter | Google Gemini via Mozaik 4.2.0's `GeminiGenerateContent` (`@google/genai`) |
| Credential variable | `GEMINI_API_KEY` (read by the adapter as `process.env.GEMINI_API_KEY`) |
| Model | `gemini-3.5-flash-lite`, thinking level `low` |
| Structured output | Mozaik passes the JSON schema as Gemini's `responseSchema` with `responseMimeType: application/json`; Counterbill sends the OpenAPI-style subset Gemini accepts and still validates every answer with Zod |
| Test mode | **Off** (`COUNTERBILL_INFERENCE` removed from `.env`); every run below is recorded as `inferenceMode: live` |
| Pacing / retries | 10 calls per minute shared across processes (database-backed), 3 retries, waits at most 75 s, 3 attempts per task |

### Which Gemini models the free tier serves (checked with `pnpm gemini:models`, not assumed)

| Model (supported by Mozaik 4.2.0) | Your free tier |
|---|---|
| `gemini-3.5-flash-lite` | **usable**, ≈ 0.9 s for a one-word reply. Chosen. |
| `gemini-3.5-flash` | usable, 4–15 s for a one-word reply |
| `gemini-3.8-flash` | answered once after 91 s, returned HTTP 503 on the next probe: avoided |
| `gemini-3.1-pro-preview` | **no free-tier quota**: HTTP 429 `RESOURCE_EXHAUSTED`, retry in ≈ 78,000 s (≈ 21 h) |

(The Gemini API lists other models, e.g. `gemini-2.5-flash`, but Mozaik 4.2.0 does not support them, so they are not used.)

## Final recorded runs

Final pass with the shipped code. All four runs completed, none finished with a failed agent. "Validation retries" are answers
the model produced that Counterbill's checks rejected and sent back with the reasons; the retry succeeded each time.

| Sample / step | Run | Status | Model calls | Duration | Agent tasks | Overlapping agent pairs | Start spread of first 4 loops | Validation retries | Rate-limit waits | Tokens in / out |
|---|---|---|---|---|---|---|---|---|---|---|
| Volume dispute: first run | `start` | completed | 11 | 29.4 s | 11 | 11 | **16 ms** | 1 (Case guard) | 0 | 16,980 / 4,382 |
| + published survey | `reassess` | completed | 6 | 18.6 s | 6 | 2 | 3.8 s | 0 | 0 | 14,017 / 4,085 |
| + 1.00 CBM rate sheet (hypothetical) | `reassess` | completed | 8 | 43.7 s | 8 | 4 | 3.6 s | 0 | 0 | 25,141 / 5,112 |
| Cargo classification: first run | `start` | completed | 8 | 51.6 s | 8 | 7 | **9 ms** | 1 (Drafting citation) | 0 | 10,529 / 3,428 |

The reassessments start only the agents the new evidence affects, which is why their first four tasks are spread over a few
seconds: Evidence and Contract start together on the new document; Timeline and Billing wake on Evidence's `fact.recorded` event.

First run of the volume sample, as recorded (UTC; every row is a distinct Mozaik loop):

```
agent     loop      started       finished      status
evidence  8585d2eb  10:01:38.466  10:01:42.839  completed
contract  1a364313  10:01:38.467  10:01:40.824  completed
timeline  c24b4234  10:01:38.467  10:01:40.355  completed
billing   18c87b66  10:01:38.482  10:01:40.559  completed   (first pass: no facts yet)
case      e7e2de66  10:01:42.650  10:01:44.936  failed      classification "insufficient_evidence" is not supported by the current calculations
timeline  fb1a6a7e  10:01:42.847  10:01:44.111  completed   (woken by Evidence's fact.recorded)
billing   e53d6e31  10:01:42.854  10:01:44.071  completed   (re-run on the recorded facts)
case      884ba797  10:01:44.936  10:01:47.018  completed   (retry, with the reason fed back)
drafting  b0489898  10:01:47.033  10:01:49.071  completed
```

## What the real model produced

**Volume dispute (the primary sample).** The numbers are the same as in test mode because code calculates them; the model chose
the comparisons and wrote the readings.

| Step | Classification | Difference under review | Reading the model wrote (headline) |
|---|---|---|---|
| first run | `declared_volume_conflicts_with_bill` | ₦298,100 vs the packing-list estimate | "A comparison shows a volume difference against the bill; the contractual rating basis is unresolved." |
| + survey | `measured_volume_differs_basis_unresolved` | **₦189,700** vs the surveyed 0.75 CBM | "A survey establishes a measured volume of 0.75 CBM against a billed volume of 1.10 CBM, but the contractual rating basis remains unresolved." |
| + rate sheet | `contract_term_may_explain_bill` | **₦54,200** left unexplained by the 1.00 CBM minimum | "A contract term with a 1.00 CBM minimum partially explains the billed volume, leaving a smaller discrepancy against the bill." |

Stored reasons for the change (model-written, from the case): *"Survey data D4 (F18) and calculation C5-C8 now provide a measured volume of 0.75 CBM, shifting the comparison from declared to measured volume."* and, at the rate-sheet step, *"The introduction of contract term D5 establishing a 1.00 CBM minimum volume allows a revised comparison showing that the contractual baseline accounts for most of the billed charge."* The letter was revised at each step (draft v2 → v3 → v5), earlier findings were kept as
superseded (11 by the end), and the 0.757348 CBM package sum was calculated by code.

**Cargo classification (secondary sample).** There is no volume comparison to make, and the model said so
(`conflicting_evidence_needs_input`: "A dispute involves an FCL-to-LCL cargo conversion, but contractual terms and billed volume are unresolved.").
Its questions are the ones the PRD expects: *who approved or instructed the change of mode from FCL to LCL; which quote or booking version
applied; what written instructions or booking confirmation exist; which bill of lading shows the final mode.* The letter requests
exactly those and proposes an adjustment "only if warranted". It does not accuse anyone. (One "please clarify" question merely restates the importer's own statement, which is cosmetic.) In earlier passes the model wrote amounts as `27132000 NGN`; the final run wrote `₦27,132,000`.

## Real rate limiting, observed

- **A real HTTP 429 from the free tier was hit and handled** (retained in
  [`live-gemini-attempt2-flash-lite-validation-failures.json`](traces/live-gemini-attempt2-flash-lite-validation-failures.json)):
  the Drafting Agent's call was rate-limited; the provider asked for 15 s; Counterbill recorded an `agent.rate_limited` event,
  waited 16 s (only that agent), retried, and the task completed. In a later run Billing was told to wait 42 s and recovered the
  same way while the Case and Drafting agents carried on and then revised once Billing's result arrived (that trace was
  overwritten by later runs; the event was `agent.rate_limited`, `waitSeconds: 43`, billing completed 44 s later).
- **A real exhausted quota**: the opt-in test `tests/integration/live-gemini.test.ts` (`RUN_LIVE_GEMINI=1`) runs a case on
  `gemini-3.1-pro-preview`, which has no free-tier quota for this key. It passed: every agent failed with `provider_quota_exhausted`
  ("…will not switch models for you"), at most 8 calls were made, the run ended in under 90 s instead of waiting a day, nothing
  was stored that the model had not produced, no flash model was ever called, and the key was not printed.
- No paid model or canned answer was ever substituted.

## What went wrong along the way (and what changed)

Each attempt's trace is kept in `docs/traces/`.

1. **`live-gemini-attempt1-billing-tool-call-rejected.json`.** Billing failed with HTTP 400 *"Function call is missing a thought_signature"*.
   Gemini 3 attaches a `thoughtSignature` to function calls and requires it back; Mozaik 4.2.0's `FunctionCallItem` and Gemini
   mapper drop it. Fix: tools are not offered to Gemini models (the tools were an optional extra; the arithmetic is deterministic
   server code either way). The run was reported honestly as "finished with limitations: billing did not complete".
2. **`live-gemini-attempt2-flash-lite-validation-failures.json`.** The Case Agent's answers repeatedly failed validation (it labelled the
   state "measured volume differs" before any measurement existed; it left citations empty; one change reason said "following previous
   feedback"), so the assessment stayed stale after the survey step. Fixes: a deterministic guard that the classification must be
   supported by the calculations, the allowed set shown to the model up front, clearer prompt rules, a third bounded attempt.
3. **`live-gemini-attempt3-flash-lite-guarded.json`.** Right classification and amounts, but the model kept re-proposing Billing's own findings and the run was
   marked "partial" even though a later Case pass had succeeded. Fixes: those duplicates are ignored (and counted), and a later
   successful pass clears an earlier failure of the same agent.
4. **`live-gemini-cargo-attempt1-evidence-rejected.json`.** The Evidence Agent returned some facts with no citation; the all-or-nothing check
   discarded all of them three times. Fix: per-fact verification: unverifiable facts are dropped and counted, an answer with no verifiable fact is still rejected.
5. **`live-gemini-cargo-attempt2-generic-questions.json`.** Valid but generic questions (rate sheet) for a shipment-mode dispute; a missing-evidence
   finding marked "supported". Fixes: shipment-mode guidance, "missing evidence is never supported".
6. **`live-gemini-cargo-attempt3-billing-missing-ref.json`.** Billing failed because the model asked for a comparison with no billed volume to compare.
   Fix: an empty slot becomes a "missing variable", not an error.
7. **Duplicate questions** (11 near-identical questions on the volume sample): near-duplicates of open questions are merged, and the Case Agent can close
   questions that new evidence answers. After the fix the same sample ended with 6.
8. Pacing was per worker process, but one key has one quota: it is now shared through the database.

## Known weaknesses seen on the real model

- A small model (`flash-lite`) needs the validation gates: in these runs it produced answers that were rejected and retried
  (the counts are in the table); two of the final four runs needed one retry. A run of a weaker or busier model can end "needs input" with failed agents rather than a wrong result.
- Wording quality is serviceable, not polished (see the notes above). The first-run reading of the volume sample varied between runs
  (`declared_volume_conflicts_with_bill` or `conflicting_evidence_needs_input`; both pass the guard).
- Latency varies a lot on the free tier (one drafting call took 48 s in an earlier run; `gemini-3.8-flash` was unusable).
- The per-minute window is a fixed minute shared by all runs of this key, so a burst across a window boundary can still draw a 429; the retry path handles it.
- Mozaik 4.2.0's Gemini adapter limitation (thought signatures) means no tool calling on Gemini; documented in `docs/DECISIONS.md`.

## Reproduce

```bash
pnpm gemini:models                                    # which models your key can use
pnpm dev                                              # in one terminal
pnpm live:check volume-dispute-aug-2026 survey rate-sheet
pnpm live:check cargo-classification-jun-2026
RUN_LIVE_GEMINI=1 pnpm exec vitest run tests/integration/live-gemini.test.ts   # real 429 / quota check (needs `pnpm db:start`)
```

`live:check` saves a trace and summary to `.data/live-check/` (git-ignored). Results will differ run to run: it is a language model.
