# Source verification record

The product requirements document cites two Nigerian Shippers' Council (NSC) reports. This file records what was
independently checked, how, and what could **not** be checked. A source register in a PRD is not proof; this is.

**Checked on:** 31 October 2026, by downloading each page's HTML directly (HTTP 200) and reading the article body.
The text was read in full from the HTML, not from a summary. The pages are live public pages and may be edited or removed.
Counterbill stores short, attributed excerpts in `fixtures/` so the samples stay usable if a page is unreachable; it does
not store or redistribute the articles.

## Report 1: volume dispute (primary sample)

- URL: https://shipperscouncil.gov.ng/npera-probe-finds-disputed-cargo-volume-overstated-by-0-35-cbm-in-freight-billing-case/
- Title (as printed): "NPERA PROBE FINDS DISPUTED CARGO VOLUME OVERSTATED BY 0.35 CBM IN FREIGHT BILLING CASE"
- Page metadata publication time: 2026-08-31. The body text opens with the date **25 August 2026**. Counterbill cites 31 August 2026 (publication) and notes the body date.

| Fact in the PRD | Verified against the page? |
|---|---|
| Six-package LCL consignment | Yes |
| Billed volume 1.10 CBM | Yes |
| Packing-list estimate 0.55 CBM | Yes ("approximately 0.55 CBM") |
| Surveyed volume 0.75 CBM | Yes |
| Rate ₦542,000 per CBM | Yes (stated as applied by the carrier, per the case handler) |
| ₦596,200 billed / ₦406,500 at survey volume / ₦189,700 difference | Yes, as printed. Recomputed independently: 1.10 × 542,000 = 596,200; 0.75 × 542,000 = 406,500; difference 189,700. |
| Six package dimension sets sum to 0.757348 CBM | Dimensions are printed; the sum was computed independently (see below) and is **not** stated in the report. |
| Rating methodology / contract terms not established | Yes: "it did not determine the underlying rating methodology or contractual terms used by 3 Brothers Cargo to calculate the 1.10 CBM chargeable volume" |
| Importer named "Import with Martha" | Yes |

Dimensions printed (L × W × H cm): 120×34×22, 83×56×60, 67×46×34, 50×24×50, 109×38×40, 182×64×5.
Independent sum: 89,760 + 278,880 + 104,788 + 60,000 + 165,680 + 58,240 = 757,348 cm³ = **0.757348 CBM**.
The report states 0.75 CBM. Counterbill treats the 0.007348 CBM gap as a rounding or measurement-method question, never as a contradiction or as wrongdoing.

Things the report says that the product handles with care:

- The report itself calls the ₦189,700 figure an "overcharge". Counterbill labels it "difference under review" because the same report says the contractual basis was not determined. A published characterisation is attributed in the sample excerpt, not adopted as Counterbill's conclusion.
- Other facts in the report that the samples use: complaint filed online 20 July 2026; joint survey 14 August 2026 at a cargo release facility in Lagos; the importer paid under protest to secure release, without prejudice to the dispute; the carrier is described as China-based and the relationship with a Nigerian receiving agent was not established.
- The report names individual officials and an independent surveyor. Counterbill's samples omit those names; they are not needed.

**Not published, therefore reconstructed and labelled everywhere:** the invoice, the packing list, any rate sheet or quote. The
"hypothetical rate sheet" with a 1.00 CBM minimum is an illustration invented to show how a stated term changes the analysis. It is not in the report and is labelled "Hypothetical illustration; not part of the published report".

## Report 2: cargo conversion dispute (secondary sample)

- URL: https://shipperscouncil.gov.ng/cargo-conversion-dispute-nsc-resolves-freight-and-classification-row-between-importer-and-logistics-firm/
- Metadata publication time: 2026-06-23. Tripartite meeting 17 June 2026.
- Verified: ~50 CBM of beach umbrellas, China to Lagos; importer says a dedicated 40ft FCL was contracted; cargo handled as consolidated LCL; charges ₦27,132,000 ("approximately ₦450,000 per CBM", as printed); shipping line denied contractual involvement; forwarder produced MBL and HBL; meeting found a contract with the forwarder and a communication breakdown; flat ₦19,000,000 settlement by 25 June 2026 with proof filed; Clarion to revise marketing material by 30 June 2026.
- No package dimensions, billed volume, packing-list volume or survey volume are published, so no CBM comparison can be built from this report. The sample asks classification and quote-version questions instead.

## Third sample (demurrage): not shipped

The PRD lists a third sample "a published NSC documentation/demurrage resolution" without a URL. None was located and verified,
so **no third sample is included**. Inventing one would contradict the product's own rules.

## Limits of this verification

- It confirms the pages said these things on 31 October 2026. It does not verify the underlying events, the parties' claims or any contract.
- The importer's and carrier's own documents were not available to anyone here.
- Nothing in this repository should be read as a finding about the named companies. The samples reproduce what a regulator published, with its limits.
