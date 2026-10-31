# Frontend redesign: audit, system and verification

Written on 31 October 2026. Everything below was checked in the running application; where a claim is not verified it says so.

## 1. Truthfulness audit (before any visual work)

Question asked: can the interface show something that looks like a real investigation but is not?

| Area | Finding | Action |
|---|---|---|
| Scripted model output | Reachable only with `COUNTERBILL_INFERENCE=test`. Never implicit: with no key and no flag, starting a run returns a setup error (verified by an integration test). Test runs are labelled TEST MODE in the UI, trace, evidence summary and exports. | **Added:** a production build now refuses test mode unless `COUNTERBILL_ALLOW_TEST_IN_PRODUCTION=1` is also set (`test_mode_blocked`), so a stray variable on a deployed server cannot turn the product into canned output. The e2e config sets both on purpose. |
| Fallback after a provider failure | None. A quota or 5xx failure retries a bounded number of times, then stops with a typed error and keeps partial results. No second model, no paid model, no canned text. | None needed. |
| Landing page | The old page described outputs rather than showing run activity. The new hero visual is labelled "Illustrative workflow" and shows only figures from the published example; it shows no agent progress and nothing runs on page load. | New page written to that rule. |
| "Live" badge in the agent panel | It reported the event-stream connection, not the model, and could be read as "live AI". | Renamed **Connected / Connecting / Reconnecting**. |
| Static "Saved" label in the workspace header | Always shown, not tied to a save. | Removed. (The letter editor's own "All changes saved" is driven by real saves and stays.) |
| "Sample" / "demo" wording | Product identity leaked into URLs and labels. | Renamed to **Example**; `/demo/...` redirects (308) to `/examples/...`. Stored provenance labels ("Reconstructed for demonstration; not an original invoice", "Hypothetical illustration…") are unchanged on purpose, because they are the disclosure. |
| Dashboard data | Strictly the signed-in user's own cases; counts come from `/api/cases`. Examples are ownerless and never listed. | None needed. |
| Privacy copy | Was a fixed paragraph. | FAQ and docs now take the provider from the server's configuration (`src/server/privacy-note.ts`) and make no claim about retention. |

## 2. Design system

Tokens live in `src/styles/tokens.css` and are the only place colours are defined.

| Token | Light | Dark |
|---|---|---|
| canvas | `#F7F7F5` | `#09090B` |
| surface | `#FFFFFF` | `#111114` |
| raised | `#EFEFEB` | `#19191E` |
| border | `#DCDCD6` | `#2B2B33` |
| text | `#18181B` | `#F5F5F7` |
| text-2 | `#575762` | `#A5A5B1` |
| accent | `#C2410C` | `#F97316` |
| accent text (on accent) | `#FFFFFF` | `#09090B` |

Derived: hover, soft accent fill, focus ring, a stronger border for form controls (`--control-border`, 3:1 or better), and green / amber / red used **only** for outcomes (a coloured dot plus text; only failures get a tinted chip). Dark follows `prefers-color-scheme` unless Light or Dark was chosen in the theme menu (`data-theme`, remembered in `localStorage`).

Type: Inter Tight (headings, wordmark) and Inter (body, controls), self-hosted variable fonts from `@fontsource-variable`, so there is no third-party request and no flash of fallback. `tests/e2e/visual.spec.ts` asserts the computed `font-family` of the hero heading, body and buttons and that the font files report `loaded`. Figures use tabular lining numerals. Body 16 px, app controls 14 px, hero 68 px at 1280 and above (clamped), 40 px on a phone, content width 1200 px, paragraphs 60 to 70 characters.

Brand mark: two offset document edges and one check stroke (`src/components/BrandMark.tsx`, `src/app/icon.svg`). It uses `currentColor` plus the accent token, so it follows the theme; the favicon carries its own light/dark rules.

Texture: a 56 px hairline grid (`.grid-bg`), 4 to 5 percent opacity, masked to fade out, on the landing hero, the closing band and the page intros only. It is absent behind documentation, forms, tables and the workspace.

### Contrast (WCAG 2.x, computed from the token values by `.tmp/contrast.mjs` and enforced by axe in both themes)

| Pair | Light | Dark | Needed |
|---|---|---|---|
| text on canvas / surface / raised | 16.5 / 17.7 / 15.4 | 18.3 / 17.3 / 16.1 | 4.5 |
| secondary text on canvas / surface / raised | 6.65 / 7.13 / 6.19 | 8.16 / 7.73 / 7.19 | 4.5 |
| accent text on canvas / surface | 4.83 / 5.18 | 7.10 / 6.72 | 4.5 |
| button label on accent | 5.18 | 7.10 | 4.5 |
| green / amber / red on surface | 5.02 / 7.09 / 6.47 | 10.82 / 11.29 / 6.81 | 4.5 |
| focus ring on canvas | 6.25 | 9.16 | 3 |
| form-control border on canvas / surface | 3.24 / 3.48 | 3.79 / 3.59 | 3 |

## 3. Two diagnoses requested

**"1 Issue" in the Next.js indicator.** I crawled every public route, the signed-in routes and the example workspace in `next dev`, in both colour schemes, recording console errors and warnings, failed requests and the text of the dev overlay's shadow DOM. Before the redesign nothing was logged and the overlay showed no issue text, so I could not reproduce it on the code as it was. The indicator that appears bottom-left in development is the dev overlay itself, not an application element, and does not exist in a production build. I did not "fix" a message I could not observe. After the redesign the same crawl was repeated (result in section 4). If it appears again on your machine, the overlay's own panel names the cause; send that text.

**The "extremely compressed" example page.** I could not see the attached screenshots, so I tested the candidates directly at browser zoom 100% on the new `/examples` page: root and body font size (16 px), `devicePixelRatio` (1), container width (1200 px at 1280 and 1440, never above 1280), card width (at least 480 px on desktop; full width minus gutters on a phone), header height (68 to 76 px). None of those cause compression; they are asserted in `visual.spec.ts` so a regression fails the build. The old page had two inline-styled `container` blocks with `maxWidth: 860` on the detail page and a two-column grid inside a 70ch-wide card, which squeezes text on narrower desktops; the new listing and detail pages do not use that structure. If your screenshot was taken with the browser zoomed above 100% or with a device pixel ratio above 1, the page will look larger or denser than designed.

## 4. Verification

See `docs/TEST_RESULTS.md` for the commands and outcomes of this change, and `docs/screenshots/` and `public/docs/` for captured pages (the latter are produced by `SHOTS=1 pnpm exec playwright test visual.spec.ts` against a production build in test mode).
