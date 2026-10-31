import Link from 'next/link';
import { EvidenceTimeline } from '@/components/landing/EvidenceTimeline';
import { Faq, type FaqItem } from '@/components/landing/Faq';
import { Motion } from '@/components/landing/Motion';
import { config } from '@/server/config';
import { DEMO_CASES } from '@/server/demo';
import { processingNote } from '@/server/privacy-note';

const EXAMPLE = DEMO_CASES[0];
const EXAMPLE_HREF = `/examples/${EXAMPLE.slug}`;

export const dynamic = 'force-dynamic';

function faqItems(): FaqItem[] {
  const note = processingNote();
  const maxMb = Math.round(config.maxFileBytes / 1024 / 1024);
  return [
    {
      q: 'Who is Counterbill for?',
      a: (
        <p>
          Importers, clearing agents and small logistics teams who have a freight bill that does not match the quote, packing list or measurements they hold. The examples are China-to-Lagos groupage (LCL) shipments; the comparison itself is about volumes, rates and charges, not one route.
        </p>
      ),
    },
    {
      q: 'Which documents can I upload?',
      a: (
        <p>
          PDF, PNG, JPG, .eml (email) and .txt files, up to {maxMb} MB each; PDFs up to 60 pages. Typical records are the invoice, a quote or rate sheet, the packing list, a survey and the messages around the booking. You can also type in a statement of your own.
        </p>
      ),
    },
    {
      q: 'Can it read scanned documents?',
      a: (
        <p>
          Not automatically. Counterbill reads the text in a PDF, .eml or .txt file. A scan or a photo is stored and shown to you, but it is not text-recognised: it is marked “needs manual review” and you type in the figures that matter, which are then recorded as your own statement.
        </p>
      ),
    },
    {
      q: 'Does a difference mean I am owed a refund?',
      a: (
        <p>
          No. A difference between a bill and a measurement is arithmetic. Whether you are owed anything depends on the agreed terms: a minimum volume, a rounding rule, a rate that applies. Counterbill keeps those two things apart, says what the documents do not show, and writes the letter as a request for explanation.
        </p>
      ),
    },
    {
      q: 'What happens when I add new evidence?',
      a: (
        <p>
          The case is reassessed, not restarted. New facts are extracted with their sources, the numbers are recalculated, and the earlier reading is kept, marked superseded, with a plain-language reason for the change. The letter draft is revised and tells you what moved.
        </p>
      ),
    },
    {
      q: 'Does Counterbill send the complaint?',
      a: <p>No. It produces a draft and a PDF. You review and edit the wording, and you send it yourself. Exports need you to confirm that you have reviewed the letter.</p>,
    },
    {
      q: 'Who processes my uploaded documents?',
      a: (
        <>
          <p>
            Your files are stored privately against your account on this deployment’s database. {note.sentence}
          </p>
          <p>
            Details are in <Link href="/docs#data-and-privacy">Storage and provider processing</Link>.
          </p>
        </>
      ),
    },
    {
      q: 'How do the public examples work?',
      a: (
        <p>
          Each example is based on a report published by the Nigerian Shippers’ Council. Where the underlying invoice or packing list was never published, a reconstruction is used and labelled as such, everywhere it appears and in exports. When you start one, you get your own copy to work with. <Link href="/examples">See the examples</Link>.
        </p>
      ),
    },
    {
      q: 'How can I delete my case?',
      a: (
        <p>
          Open the case and choose delete: its documents, facts, letters and exports are removed. To remove everything, delete your account from Settings. Neither action can be undone, and neither can recall text a provider has already received. <Link href="/docs#deleting-data">How deletion works</Link>.
        </p>
      ),
    },
  ];
}

export default function Home() {
  return (
    <>
      <Motion />

      {/* A. Hero */}
      <section className="hero" aria-labelledby="hero-h">
        <div className="grid-bg" aria-hidden="true" />
        <div className="container">
          <div>
            <p className="eyebrow accent" data-intro="">
              Freight billing, checked
            </p>
            <h1 id="hero-h" data-intro="">
              <span>Question the charge.</span>
              <span className="quiet">Build your case.</span>
            </h1>
            <p className="lead" data-intro="">
              Compare your freight invoice with the records behind it. Find the differences, check the evidence, and prepare a complaint you can review and send.
            </p>
            <div className="cta-row" data-intro="">
              <Link href="/app/new" className="btn btn-primary btn-lg">
                Start a case
              </Link>
              <Link href={EXAMPLE_HREF} className="btn btn-lg">
                Explore an example
              </Link>
            </div>
            <p className="hero-note" data-intro="">
              For importers, clearing agents and small logistics teams.
            </p>
          </div>

          <figure className="recon" aria-label="Illustrative workflow: records compared, a sourced finding, and the resulting complaint">
            <figcaption className="recon-head" data-seq>
              <b>Illustrative workflow</b>
              <span>Figures from a published example</span>
            </figcaption>
            <div className="recon-row" data-seq>
              <span>
                Invoice, billed volume
                <span className="src">Freight invoice · reconstructed</span>
              </span>
              <span className="num">1.10 CBM</span>
            </div>
            <div className="recon-row" data-seq>
              <span>
                Survey, measured volume
                <span className="src">Joint survey · published report</span>
              </span>
              <span className="num">0.75 CBM</span>
            </div>
            <div className="recon-row diff" data-seq>
              <span>
                Difference under review
                <span className="src">(1.10 − 0.75) × ₦542,000</span>
              </span>
              <span className="num">₦189,700</span>
            </div>
            <div className="recon-finding" data-seq>
              <span className="chip chip-warn">Unresolved</span>
              <p>Billed volume is above the measured volume. The rating basis for 1.10 CBM is not shown in any document.</p>
              <span className="src-row">
                <span className="source-chip static">Invoice</span>
                <span className="source-chip static">Survey</span>
              </span>
            </div>
            <div className="recon-letter" data-seq>
              <span className="eyebrow">Draft complaint</span>
              <p>“Please provide the calculation and the contract terms used to arrive at 1.10 CBM.”</p>
            </div>
          </figure>
        </div>
      </section>

      {/* B. The problem and outcome */}
      <section className="band" aria-labelledby="problem-h">
        <div className="container">
          <div className="band-head" data-reveal>
            <p className="eyebrow">The problem</p>
            <h2 id="problem-h">One charge. Several conflicting records.</h2>
            <p>The invoice says one thing. The quote or the packing list says another. A survey may say a third. What you need is the size of the difference and the right questions to ask the carrier about it.</p>
          </div>
          <div className="conflicts" data-reveal>
            <div>
              <h3>Billed more than declared</h3>
              <p>The invoice charges for more volume than your packing list says you shipped.</p>
              <span className="pair">Invoice <i aria-hidden="true">≠</i> Packing list</span>
            </div>
            <div>
              <h3>Booked as one thing, billed as another</h3>
              <p>A full container was agreed; the cargo was handled and charged as shared (LCL).</p>
              <span className="pair">Booking <i aria-hidden="true">≠</i> Invoice</span>
            </div>
            <div>
              <h3>Quoted one rate, charged another</h3>
              <p>The rate sheet or quote and the invoice do not use the same rate, minimum or rounding.</p>
              <span className="pair">Quote <i aria-hidden="true">≠</i> Invoice</span>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 'var(--space-group)', fontSize: 14.5, maxWidth: '62ch' }}>
            For each, Counterbill lines the records up, recalculates the difference, and shows what none of them prove.
          </p>
        </div>
      </section>

      {/* C. How it works */}
      <section className="band alt" id="how-it-works" aria-labelledby="how-h">
        <div className="container">
          <div className="band-head" data-reveal>
            <p className="eyebrow">How it works</p>
            <h2 id="how-h">From a stack of papers to a sourced account.</h2>
          </div>
          <ol className="steps">
            <li data-reveal>
              <span className="rule" data-draw aria-hidden="true" />
              <h3>Add your records</h3>
              <p>Invoice, quote or rate sheet, packing list, survey, messages. Text in PDF, .eml and .txt files is read. Scans and photos are stored for you to read, and you type the key figures in.</p>
            </li>
            <li data-reveal>
              <span className="rule" data-draw aria-hidden="true" />
              <h3>Investigate the differences</h3>
              <p>Specialist agents work at the same time: extracting facts with their sources, calculating, reading the terms, building the timeline. You can watch each step and open every source.</p>
            </li>
            <li data-reveal>
              <span className="rule" data-draw aria-hidden="true" />
              <h3>Review and export your complaint</h3>
              <p>Edit the letter, confirm you have reviewed it, then download a PDF and an evidence summary. Add a document later and both are revised, with the reason shown.</p>
            </li>
          </ol>
        </div>
      </section>

      {/* D. Evidence changes the conclusion */}
      <section className="band" id="evidence" aria-labelledby="evidence-h">
        <div className="container">
          <div className="band-head" data-reveal>
            <p className="eyebrow accent">When something new turns up</p>
            <h2 id="evidence-h">Evidence changes the conclusion</h2>
            <p>A freight case is rarely settled by one document. When a new one arrives, Counterbill recalculates, keeps what it used to think, and says why the answer moved. Step through the published example.</p>
          </div>
          <div data-reveal>
            <EvidenceTimeline exampleHref={EXAMPLE_HREF} />
          </div>
        </div>
      </section>

      {/* E. What you leave with */}
      <section className="band alt" id="product" aria-labelledby="out-h">
        <div className="container">
          <div className="band-head" data-reveal>
            <p className="eyebrow">What you leave with</p>
            <h2 id="out-h">A complaint you can edit and send, with the case behind it.</h2>
            <p>Counterbill never sends anything: you review the wording, change what you like, and send it yourself. It is not legal advice and does not decide who is right.</p>
          </div>
          <div className="deliverable">
            <figure className="letter-preview" data-reveal aria-label="Illustrative complaint structure">
              <figcaption className="eyebrow">Illustrative structure · editable draft</figcaption>
              <div className="lp-row" data-stagger>
                <b>To</b>
                <span>The freight company</span>
              </div>
              <div className="lp-row" data-stagger>
                <b>Subject</b>
                <span>Request for the calculation behind invoice charges</span>
              </div>
              <div className="lp-block" data-stagger>
                <b>What we compared</b>
                <span>Your invoice, the packing list and the survey, with the figures side by side and the calculation shown.</span>
              </div>
              <div className="lp-block" data-stagger>
                <b>What we ask</b>
                <span>The rating basis, any minimum or rounding rule that applies, and the document it comes from.</span>
              </div>
              <div className="lp-block" data-stagger>
                <b>Annex</b>
                <span>Evidence summary listing each fact with the document and passage it came from.</span>
              </div>
              <div className="lp-actions">
                <span className="lp-chip">PDF letter</span>
                <span className="lp-chip">PDF evidence summary</span>
                <span className="lp-chip">CSV</span>
              </div>
            </figure>
            <ul className="deliverable-list" data-reveal>
              <li>
                <h3>A comparison with calculations</h3>
                <p>Billed, declared, measured and chargeable volume side by side, with each formula shown.</p>
              </li>
              <li>
                <h3>Findings linked to their sources</h3>
                <p>Every finding carries a status and the passages behind it, so you can open the page it came from.</p>
              </li>
              <li>
                <h3>Questions about missing evidence</h3>
                <p>What the documents do not show, and what to ask for next.</p>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* F. Published example */}
      <section className="band" aria-labelledby="example-h">
        <div className="container">
          <div className="band-head" data-reveal>
            <p className="eyebrow">Published example</p>
            <h2 id="example-h">See it on a real regulator report.</h2>
          </div>
          <article className="example-card feature" data-reveal aria-labelledby="ex-title">
            <div>
              <div className="disclosure">
                <span>Based on a published report.</span>
                <span>Some supporting documents are reconstructed for this example.</span>
              </div>
              <h3 id="ex-title" style={{ fontSize: 'clamp(1.375rem,1.1rem + 1vw,1.875rem)', margin: '14px 0 8px' }}>
                {EXAMPLE.title}
              </h3>
              <p>
                {EXAMPLE.source.publisher}, {EXAMPLE.source.published}. A volume charge, a packing list, a survey and a regulator’s finding that the rating basis was never established.
              </p>
              <div className="cta-row" style={{ marginTop: 18 }}>
                <Link href={EXAMPLE_HREF} className="btn btn-primary">
                  Explore this example
                </Link>
                <Link href="/examples" className="btn btn-ghost">
                  All examples
                </Link>
              </div>
            </div>
          </article>
        </div>
      </section>

      {/* G. FAQ */}
      <section className="band alt" id="faq" aria-labelledby="faq-h">
        <div className="container">
          <div className="band-head" data-reveal>
            <p className="eyebrow">Questions</p>
            <h2 id="faq-h">Before you upload anything</h2>
          </div>
          <div data-reveal>
            <Faq items={faqItems()} />
          </div>
        </div>
      </section>

      {/* H. Final action */}
      <section className="closing" aria-labelledby="closing-h">
        <div className="grid-bg" aria-hidden="true" />
        <div className="container">
          <h2 id="closing-h" data-reveal>
            Get the records on your side.
          </h2>
          <p className="lead" data-reveal>
            Start with the invoice. Add the rest as you find it.
          </p>
          <div className="cta-row" data-reveal>
            <Link href="/app/new" className="btn btn-primary btn-lg">
              Start a case
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
