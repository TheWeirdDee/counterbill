import Link from 'next/link';
import { config } from '@/server/config';
import { processingNote } from '@/server/privacy-note';

export interface DocsGroup {
  title: string;
  audience: 'user' | 'technical';
  items: { id: string; label: string }[];
}

export const DOCS_NAV: DocsGroup[] = [
  {
    title: 'Using Counterbill',
    audience: 'user',
    items: [
      { id: 'what-it-does', label: 'What Counterbill does' },
      { id: 'getting-started', label: 'Getting started' },
      { id: 'creating-a-case', label: 'Creating a case' },
      { id: 'supported-files', label: 'Supported files and limits' },
      { id: 'reviewing-sources', label: 'Reviewing sources' },
      { id: 'correcting-facts', label: 'Correcting extracted facts' },
      { id: 'understanding-discrepancies', label: 'Understanding discrepancies' },
      { id: 'chargeable-vs-measured', label: 'Chargeable and measured volume' },
      { id: 'adding-evidence', label: 'Adding evidence and reassessment' },
      { id: 'letter-and-export', label: 'Reviewing and exporting the complaint' },
      { id: 'example-provenance', label: 'Where the examples come from' },
      { id: 'data-and-privacy', label: 'Storage and provider processing' },
      { id: 'deleting-data', label: 'Deleting your data' },
      { id: 'scope', label: 'What Counterbill does not do' },
      { id: 'troubleshooting', label: 'Troubleshooting' },
    ],
  },
  {
    title: 'Technical internals',
    audience: 'technical',
    items: [
      { id: 'architecture', label: 'Architecture' },
      { id: 'agents', label: 'Agents and Mozaik' },
      { id: 'evidence-integrity', label: 'Evidence integrity' },
      { id: 'providers', label: 'Model providers and limits' },
      { id: 'running-locally', label: 'Running it yourself' },
    ],
  },
];

/** A theme-aware screenshot: both captures are in the page, CSS shows the one matching the active theme. */
function Shot({ name, alt, caption }: { name: string; alt: string; caption: string }) {
  return (
    <figure>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="shot shot-light" src={`/docs/${name}-light.png`} alt={alt} loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="shot shot-dark" src={`/docs/${name}-dark.png`} alt="" aria-hidden="true" loading="lazy" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function DocsContent() {
  const note = processingNote();
  const maxMb = Math.round(config.maxFileBytes / 1024 / 1024);
  return (
    <>
      <section id="what-it-does">
        <span className="audience">Using Counterbill</span>
        <h2>What Counterbill does</h2>
        <p>
          You have a freight invoice that does not match the quote, packing list or measurements you hold. Counterbill reads the records you give it, records each fact with the passage it came from, recalculates the numbers with exact arithmetic, and shows where the records disagree and what they leave unproven. It then drafts a complaint you can edit.
        </p>
        <p>
          It is built around one idea: <b>a difference between a bill and a measurement is not the same as money you are owed.</b> Counterbill reports the difference, says what depends on terms it has not seen, and writes the letter as a request for explanation.
        </p>
        <Shot name="case-overview" alt="A case workspace showing the summary strip with billed volume, measured volume, difference under review and contractual basis, above the findings." caption="A case: the figures under review at the top, findings in the middle, the evidence list on the left and agent activity on the right." />
      </section>

      <section id="getting-started">
        <h2>Getting started</h2>
        <ol>
          <li>
            <b>Look first.</b> Open an <Link href="/examples">example case</Link> to see a finished-style workspace built from a published report. You can start your own copy without an account.
          </li>
          <li>
            <b>Create an account</b> to use your own records. Cases and documents belong to your account only.
          </li>
          <li>
            <b>Start a case</b> from the Cases page, add the records you have, and start the investigation.
          </li>
        </ol>
        <p>You do not need every document. A case with only an invoice will tell you what it cannot say and which record would settle it.</p>
      </section>

      <section id="creating-a-case">
        <h2>Creating a case</h2>
        <p>The new-case flow has three steps.</p>
        <ol>
          <li>
            <b>Shipment basics.</b> The case name, your company and the freight company, origin and destination, shipment type (FCL, LCL or unknown), invoice currency, the billed amount if you know it, and in your own words what looks wrong. Only the case name is required. What you write is stored as a statement of your own and is labelled that way everywhere.
          </li>
          <li>
            <b>Add evidence.</b> Upload files, or type in a figure from a scan or photo. Each file shows whether it was read, needs manual review, or was refused and why.
          </li>
          <li>
            <b>Confirm and investigate.</b> Check the list, then start. The investigation runs in the background; you can leave the page and come back.
          </li>
        </ol>
        <Shot name="new-case" alt="The new-case form at step two, adding evidence." caption="Step two: adding evidence. Each file reports whether its text could be read." />
      </section>

      <section id="supported-files">
        <h2>Supported files and limits</h2>
        <table className="t">
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">What happens</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>PDF with a text layer</td>
              <td>Text is read page by page. Up to 60 pages.</td>
            </tr>
            <tr>
              <td>.txt, .eml</td>
              <td>Read as text. For .eml, the message body is used.</td>
            </tr>
            <tr>
              <td>PNG, JPG, scanned PDFs</td>
              <td>
                Stored and viewable, but <b>not text-recognised</b>. They are marked “needs manual review”: you type the figures that matter and Counterbill records them as your own statement, not as an extraction.
              </td>
            </tr>
            <tr>
              <td>Anything else</td>
              <td>Refused, with the reason. The file’s contents must match its extension.</td>
            </tr>
          </tbody>
        </table>
        <p>Each file can be up to {maxMb} MB. Files are untrusted input: text found inside a document is treated as evidence to read, never as an instruction to follow.</p>
      </section>

      <section id="reviewing-sources">
        <h2>Reviewing sources</h2>
        <p>
          Every fact, calculation and finding carries one or more source chips such as <code>D2-p1-s3</code>: document 2, page 1, passage 3. Choose a chip to open the document with that passage highlighted. In the Evidence tab you can read each document in full and see the facts taken from it.
        </p>
        <p>
          Counterbill checks every citation before storing anything. A fact whose cited passage does not exist, or whose quoted text does not appear in that passage, is dropped and counted rather than kept.
        </p>
        <Shot name="source-viewer" alt="The evidence reader with one passage highlighted and the facts taken from the document listed beside it." caption="The evidence reader: the cited passage is highlighted, with the facts taken from this document beside it." />
      </section>

      <section id="correcting-facts">
        <h2>Correcting extracted facts</h2>
        <p>
          If a fact was read wrongly, correct it in the Evidence tab. The correction does not overwrite the original: it becomes a new fact attributed to you, the original is marked superseded with its value intact, and the case is reassessed. The numbers and the letter then change, and you are told what moved.
        </p>
        <p>If someone else changed the case while you were editing, your correction is refused and you are asked to reload, rather than silently overwriting theirs.</p>
      </section>

      <section id="understanding-discrepancies">
        <h2>Understanding discrepancies</h2>
        <p>Each finding has a status. The status describes the evidence, not who is right.</p>
        <table className="t">
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Meaning</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Supported</td>
              <td>The cited records agree and the arithmetic follows from them.</td>
            </tr>
            <tr>
              <td>Provisional</td>
              <td>Based on an estimate or a single source. It may change when better evidence arrives.</td>
            </tr>
            <tr>
              <td>Disputed</td>
              <td>Two records give conflicting accounts. Both are shown.</td>
            </tr>
            <tr>
              <td>Unresolved</td>
              <td>The records do not show enough, for example how the carrier rated the volume.</td>
            </tr>
            <tr>
              <td>Superseded</td>
              <td>Replaced by a later reading. Kept, with the reason it changed.</td>
            </tr>
          </tbody>
        </table>
        <div className="callout">
          <p>
            <b>Arithmetic is not entitlement.</b> “Difference under review” is billed minus recalculated. Whether the carrier was entitled to bill that amount depends on terms such as a minimum volume or rounding rule. Where those are not in your records, the finding stays unresolved and the letter asks about them.
          </p>
        </div>
      </section>

      <section id="chargeable-vs-measured">
        <h2>Chargeable and measured volume</h2>
        <p>Four different volumes are easy to confuse. Counterbill keeps them apart.</p>
        <ul>
          <li>
            <b>Declared</b>: what the packing list or shipper says.
          </li>
          <li>
            <b>Measured</b>: what a survey or measurement says.
          </li>
          <li>
            <b>Billed</b>: what the invoice charges for.
          </li>
          <li>
            <b>Chargeable</b>: what the carrier’s terms say it may charge for, which can include a minimum or rounding.
          </li>
        </ul>
        <p>
          A cubic metre (CBM) is length × width × height in metres. A parcel of 120 × 34 × 22 cm is 0.08976 CBM. Package volumes are summed before any rounding, and the stated total is compared with the sum.
        </p>
        <code className="formula">difference = (billed volume − comparison volume) × rate per CBM</code>
        <p>
          If a rate sheet states a minimum, for example 1.00 CBM, the chargeable volume becomes the larger of the measurement and the minimum, and the part of the difference that the minimum explains is separated from the part it does not.
        </p>
      </section>

      <section id="adding-evidence">
        <h2>Adding evidence and reassessment</h2>
        <p>
          Add a document at any time. Counterbill does not restart: only the agents whose inputs changed run again. A packing-list update does not wake the contract or timeline work; a new quote or survey does.
        </p>
        <ul>
          <li>The new facts are recorded with their sources.</li>
          <li>Calculations are redone by code.</li>
          <li>Earlier findings that no longer hold are marked superseded and linked to what replaced them.</li>
          <li>A “what changed” summary explains the revision in plain language.</li>
          <li>The letter is revised. Sections you edited are not overwritten: a proposed update is shown for you to accept or decline.</li>
        </ul>
        <p>If you add something while an investigation is already running, the older pass is discarded rather than allowed to write stale results.</p>
      </section>

      <section id="letter-and-export">
        <h2>Reviewing and exporting the complaint</h2>
        <p>
          The Letter tab holds an editable draft. Each section shows the findings it rests on. Edit freely: your changes are saved, marked “edited by you, not verified by Counterbill”, and kept as versions you can return to.
        </p>
        <Shot name="letter" alt="The letter editor with sections, a saved-versions list and the export panel." caption="The letter: editable sections, saved versions, and the review step before export." />
        <p>
          To export, confirm that you have reviewed the letter. You can download the complaint as a PDF, an evidence summary as a PDF (calculations with formulas, findings with status, a source map, open questions and a timeline), and a CSV. Exports are refused while an investigation is still revising the letter, so you never export a stale draft.
        </p>
        <p>
          The wording is checked before it is shown: any amount or volume must match a stored fact or calculation, and language that alleges fraud, threatens, or claims an entitlement is rejected.
        </p>
        <p>
          <b>Counterbill never sends the letter.</b> Exports can contain names, addresses and payment details; check who receives them.
        </p>
      </section>

      <section id="example-provenance">
        <h2>Where the examples come from</h2>
        <p>
          The <Link href="/examples">example cases</Link> are based on reports published by the Nigerian Shippers’ Council. Each page links to its source and says when it was read.
        </p>
        <ul>
          <li>
            <b>Published facts</b> (amounts, volumes, dates, the regulator’s findings) are taken from the report.
          </li>
          <li>
            <b>Reconstructed documents</b>: where the underlying invoice or packing list was never published, a reconstruction consistent with the report is used. It is labelled “Reconstructed for demonstration; not an original invoice” in the document list, the viewer, the findings and the exports.
          </li>
          <li>
            <b>Hypothetical illustrations</b>, such as a rate sheet with a 1.00 CBM minimum, are not in the report. They exist only to show how a stated term would change the conclusion, and are labelled that way.
          </li>
        </ul>
        <p>Starting an example creates your own isolated copy in your browser. Examples never appear in any account’s case list.</p>
      </section>

      <section id="data-and-privacy">
        <h2>Storage and provider processing</h2>
        <p>
          Documents, extracted facts, calculations and letters are stored in this deployment’s PostgreSQL database against your account. Every request checks ownership on the server; another account receives “not found” for your case and its files.
        </p>
        <p>{note.sentence}</p>
        <p>
          Only text and the structured facts needed for the task are sent. Calculations are performed by Counterbill’s own code and do not use the model. Uploaded text is passed as clearly delimited data, and the model’s output is validated before anything is stored.
        </p>
        <div className="callout">
          <p>Counterbill makes no claim about how a provider retains or uses content. Do not upload anything you are not willing to have processed by the provider named above.</p>
        </div>
      </section>

      <section id="deleting-data">
        <h2>Deleting your data</h2>
        <ul>
          <li>
            <b>One case:</b> open it, choose Delete this case, and confirm. Its documents, stored files, facts, calculations, letters, exports and activity are removed.
          </li>
          <li>
            <b>Everything:</b> in Settings, use Delete my account and all data: enter your password and type DELETE to confirm.
          </li>
          <li>
            <b>Archive instead:</b> archiving moves a case out of your main list and deletes nothing.
          </li>
        </ul>
        <p>Deletion cannot be undone, and it cannot recall text a model provider has already received.</p>
      </section>

      <section id="scope">
        <h2>What Counterbill does not do</h2>
        <ul>
          <li>It is not legal advice.</li>
          <li>It does not determine liability or decide who is right.</li>
          <li>It does not guarantee or estimate a refund.</li>
          <li>It does not accuse anyone of fraud or bad faith.</li>
          <li>It does not read scans or photographs automatically.</li>
          <li>It does not send complaints, or contact anyone for you.</li>
        </ul>
      </section>

      <section id="troubleshooting">
        <h2>Troubleshooting</h2>
        <h3>“Investigations are not configured on this server”</h3>
        <p>The server has no model credentials. The message names the setting that is missing. Nothing is substituted: no scripted output and no different model.</p>
        <h3>A file says “needs manual review”</h3>
        <p>It is a scan, a photograph, or a PDF with no text layer. Open it, read the figures, and enter them as your statement.</p>
        <h3>An agent is waiting, or the run stopped partway</h3>
        <p>
          Free-tier model access has per-minute and per-day limits. Counterbill waits the delay the provider asks for, up to a bounded number of times, and shows each wait in the Activity tab. If the limit is a daily one, it stops at once and says so. The findings already recorded are kept, and you can retry only what failed.
        </p>
        <h3>“Your edits conflict with a newer version”</h3>
        <p>The letter changed while you were editing it, usually because the Drafting Agent finished a revision. Reload, and apply your edit to the newer text.</p>
        <h3>The numbers are “Not yet established”</h3>
        <p>A figure shows that when the records do not contain what it needs. Add the missing record, or answer the question listed for you on the Overview.</p>
      </section>

      <section id="architecture">
        <span className="audience">Technical internals</span>
        <h2>Architecture</h2>
        <p>
          One Next.js (App Router) application serves the interface and API. A separate worker supervisor claims queued investigation runs from PostgreSQL and starts <b>one child process per run</b>. Each child initialises one Mozaik runtime, runs the agents, and exits. PostgreSQL is the durable event log, work queue and file store; there is no Redis.
        </p>
        <ul>
          <li>
            <b>Events.</b> Every state change is an idempotent event. The browser follows a server-sent event stream with replay from the last seen id, and re-fetches one consistent snapshot when something changed, so reconnects and refreshes converge on the same state.
          </li>
          <li>
            <b>Queue.</b> Runs are claimed with leases and <code>FOR UPDATE SKIP LOCKED</code>. A crashed worker’s lease expires and the run is marked failed with a reason; a partial unique index allows one running run per case.
          </li>
          <li>
            <b>Stale results.</b> Each pass records the evidence revision it started from. If the revision changes mid-call, its results are discarded and an event says so.
          </li>
          <li>
            <b>Ownership.</b> Own accounts (scrypt), httpOnly session cookies, and a server-side ownership check on every case route.
          </li>
        </ul>
      </section>

      <section id="agents">
        <h2>Agents and Mozaik</h2>
        <p>
          Six agents are defined on <a href="https://docs.jigjoy.ai/docs/runtime">Mozaik’s runtime</a> as situation handlers that react to semantic events. They do not call each other; they publish events and others react.
        </p>
        <table className="t">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Starts on</th>
              <th scope="col">Produces</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Evidence</td>
              <td>case started; new documents</td>
              <td>Cited facts</td>
            </tr>
            <tr>
              <td>Billing</td>
              <td>case started; new facts</td>
              <td>Missing-input findings, then calculations by code</td>
            </tr>
            <tr>
              <td>Contract</td>
              <td>case started; new quotes, contracts, messages, surveys</td>
              <td>Terms found or not found, with sources</td>
            </tr>
            <tr>
              <td>Timeline</td>
              <td>case started; facts with dates</td>
              <td>Ordered events and gaps</td>
            </tr>
            <tr>
              <td>Case</td>
              <td>calculations, findings, interpretations, corrections</td>
              <td>The assessment, questions, the classification</td>
            </tr>
            <tr>
              <td>Drafting</td>
              <td>assessment updated</td>
              <td>The letter, and a summary of what changed</td>
            </tr>
          </tbody>
        </table>
        <p>
          The four first-wave agents begin within milliseconds of one <code>case.started</code> event, each in its own Mozaik <code>runLoop</code> with its own loop id and a fresh model context. The Activity tab draws the recorded start and finish of every task, so overlapping work is visible rather than asserted. A burst of results is coalesced for under two seconds so the Case Agent assesses once.
        </p>
      </section>

      <section id="evidence-integrity">
        <h2>Evidence integrity</h2>
        <ul>
          <li>
            <b>The model never calculates.</b> It chooses which facts to compare. Code in <code>src/domain</code> computes with exact decimals, and the formula is stored with each result.
          </li>
          <li>
            <b>Citations are validated.</b> Span identifiers must exist, and the quote must occur in the cited span. Failures are dropped and counted.
          </li>
          <li>
            <b>Figures in prose are checked.</b> Any amount or volume in a finding or letter that is not in a stored fact or calculation is rejected, as is accusatory or entitlement wording.
          </li>
          <li>
            <b>Classification is guarded.</b> The assessment’s classification must be supported by the stored calculations.
          </li>
          <li>
            <b>Facts are immutable.</b> A correction is a new fact; the old one is superseded.
          </li>
          <li>
            <b>Untrusted text.</b> Documents are delimited as data; instructions inside them are never followed.
          </li>
        </ul>
      </section>

      <section id="providers">
        <h2>Model providers and limits</h2>
        <p>
          The model is set by <code>MOZAIK_MODEL</code> and its key by the matching environment variable. Counterbill never falls back to a different model, a paid model or scripted output. If the configured model cannot be used it stops with a clear error and keeps partial results.
        </p>
        <ul>
          <li>Calls are paced across all runs and workers, counted in PostgreSQL, so one key’s quota is shared fairly while agents still run concurrently.</li>
          <li>Rate-limit and server errors are retried at most {config.modelMaxRetries} times, waiting the delay the provider gives; a longer wait or a per-day limit is reported immediately.</li>
          <li>Each wait and failure is a stored event shown in the Activity tab.</li>
          <li>
            A scripted <b>test mode</b> exists for automated tests. It must be selected explicitly, is labelled TEST MODE throughout, and is refused by production builds unless that is switched on deliberately.
          </li>
        </ul>
      </section>

      <section id="running-locally">
        <h2>Running it yourself</h2>
        <pre>
          <code>{`pnpm install
cp .env.example .env     # add your provider key (never commit it)
pnpm db:start            # embedded PostgreSQL
pnpm db:migrate
pnpm dev                 # web on :3000 plus the worker supervisor`}</code>
        </pre>
        <p>
          <code>pnpm test</code> and <code>pnpm test:integration</code> run the unit and worker-process tests without contacting a provider. <code>pnpm test:e2e</code> drives the browser against a production build. <code>pnpm live:check</code> runs a real investigation against the configured model and records what happened.
        </p>
      </section>
    </>
  );
}
