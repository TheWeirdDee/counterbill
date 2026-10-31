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

          <figure className="recon" data-intro="" aria-label="Illustrative workflow: records compared, a sourced finding, and the resulting complaint">
            <figcaption className="recon-head">
              <b>Illustrative workflow</b>
              <span>Figures from a published example</span>
            </figcaption>
            <div className="recon-row">
              <span>
                Invoice, billed volume
                <span className="src">Freight invoice · reconstructed</span>
              </span>
              <span className="num">1.10 CBM</span>
            </div>
            <div className="recon-row">
              <span>
                Survey, measured volume
                <span className="src">Joint survey · published report</span>
              </span>
              <span className="num">0.75 CBM</span>
            </div>
            <div className="recon-row diff">
              <span>
                Difference under review
                <span className="src">(1.10 − 0.75) × ₦542,000</span>
              </span>
              <span className="num">₦189,700</span>
            </div>
            <div className="recon-finding">
              <span className="chip chip-warn">Unresolved</span>
              <p>Billed volume is above the measured volume. The rating basis for 1.10 CBM is not shown in any document.</p>
              <span className="src-row">
                <span className="source-chip static">Invoice</span>
                <span className="source-chip static">Survey</span>
              </span>
            </div>
            <div className="recon-letter">
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
          <div className="conflict" data-reveal>
            <div>
              <div className="label">Invoice</div>
              <div className="figure">
                1.10 <small>CBM</small>
              </div>
              <p>Volume the carrier billed.</p>
            </div>
            <div>
              <div className="label">Packing list</div>
              <div className="figure">
                0.55 <small>CBM</small>
              </div>
              <p>An estimate by the shipper.</p>
            </div>
            <div>
              <div className="label">Survey</div>
              <div className="figure">
                0.75 <small>CBM</small>
              </div>
              <p>Measured by the parties.</p>
            </div>
            <div className="hot">
              <div className="label">Contract basis</div>
              <div className="figure">Not shown</div>
              <p>No document explains how 1.10 was rated.</p>
            </div>
          </div>
          <p className="muted" style={{ marginTop: 14, fontSize: 13.5 }}>
            From the published example. The invoice and packing list are reconstructed.
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
            <p className="eyebrow accent">The principal feature</p>
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
            <h2 id="out-h">A case you can put in front of someone.</h2>
          </div>
          <div className="outputs" data-reveal>
            <div className="card">
              <svg className="glyph" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h10" />
              </svg>
              <h3>A comparison with calculations</h3>
              <p>Billed, declared, measured and chargeable volume side by side, with every formula shown. Arithmetic is done by code, never by the model.</p>
            </div>
            <div className="card">
              <svg className="glyph" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 12l2 2 4-4M7 3h7l5 5v13H7z" />
              </svg>
              <h3>Findings linked to their sources</h3>
              <p>Each finding carries a status and the exact passages behind it. A citation that does not exist in your documents is rejected.</p>
            </div>
            <div className="card">
              <svg className="glyph" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 17h.01M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />
              </svg>
              <h3>Questions about missing evidence</h3>
              <p>What the documents do not show, and what to ask for, so you know whether to chase a rate sheet, a survey or an email.</p>
            </div>
          </div>
          <p className="outputs-note" data-reveal>
            <b>An editable complaint and an evidence summary,</b> downloadable as PDF. Your edits are marked as yours. The wording asks for explanation; it does not threaten, allege fraud, or claim you are owed a refund. Counterbill is not legal advice and does not decide who is right.
          </p>
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
                {EXAMPLE.source.publisher}, {EXAMPLE.source.published}. Six packages from China to Lagos were billed at 1.10 CBM; a survey measured 0.75 CBM; the regulator found the rating basis was never established.
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
