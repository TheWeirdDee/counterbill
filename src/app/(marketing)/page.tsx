import Link from 'next/link';

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="eyebrow">For importers and clearing agents</p>
          <h1>Your freight invoice doesn’t add up. Build the case.</h1>
          <p className="lead">
            Counterbill compares your invoice with your quote, packing list and any survey, recalculates the difference, shows what the documents do <em>not</em> prove, and drafts a complaint letter you can edit and send yourself.
          </p>
          <div className="cta-row">
            <Link href="/demo/volume-dispute-aug-2026" className="btn btn-primary">
              Investigate a sample case
            </Link>
            <Link href="/app/new" className="btn">
              Start with my documents
            </Link>
          </div>
        </div>
      </section>

      <section className="container" aria-labelledby="how-it-works-h" id="how-it-works">
        <h2 id="how-it-works-h" className="sr-only">
          How it works
        </h2>
        <ol className="steps" style={{ padding: 0, margin: 0 }}>
          <li>
            <h3>Upload your records</h3>
            <p className="muted">Invoice, quote or rate sheet, packing list, survey, messages. PDFs, text and .eml are read; images need their key figures typed in.</p>
          </li>
          <li>
            <h3>Watch the investigation</h3>
            <p className="muted">Six specialist agents run at the same time and react to each other’s findings. You see what each one did, with the source behind every claim.</p>
          </li>
          <li>
            <h3>Review and export</h3>
            <p className="muted">Edit the letter, then download a PDF and an evidence summary. Add a new document later and the case and letter are revised, with the reason shown.</p>
          </li>
        </ol>
      </section>

      <section className="container section" aria-labelledby="mini-h">
        <h2 id="mini-h">What a case looks like</h2>
        <p className="muted">
          From a public regulator report (reconstructed documents, clearly labelled): six packages from China to Lagos were billed at 1.10 CBM, a survey measured 0.75 CBM, and the regulator said the carrier’s rating basis was never established.
        </p>
        <div className="mini-case" role="group" aria-label="Sample case summary">
          <div>
            <div className="eyebrow">Billed volume</div>
            <div className="v">1.10 CBM</div>
          </div>
          <div>
            <div className="eyebrow">Independently measured</div>
            <div className="v">0.75 CBM</div>
          </div>
          <div>
            <div className="eyebrow">Difference under review</div>
            <div className="v">₦189,700</div>
          </div>
          <div>
            <div className="eyebrow">Contractual basis</div>
            <div className="v" style={{ fontSize: '1.05rem' }}>
              Unresolved
            </div>
          </div>
        </div>
        <p className="caveat">A difference between a bill and a measurement is not automatically a refund you are owed. Counterbill keeps those two things apart.</p>
      </section>

      <section className="container section">
        <div className="two-col">
          <div className="card">
            <h2>Who it’s for</h2>
            <p>
              Small importers (including China-to-Lagos LCL shippers) who received a freight bill that doesn’t match their quote, packing list or measurements, and clearing agents preparing a complaint for a client.
            </p>
            <h3>When to use it</h3>
            <ul>
              <li>A volume (CBM) or line-item charge looks different from what you were quoted.</li>
              <li>The shipment was booked as one thing (say FCL) and billed as another (LCL).</li>
              <li>You have some documents and want an organised, sourced account before writing to the freight company.</li>
            </ul>
          </div>
          <div className="card">
            <h2>Why it’s hard to do by hand</h2>
            <p>
              Four different numbers get mixed up: the <strong>declared</strong> volume on a packing list, the <strong>measured</strong> volume from a survey, the <strong>billed</strong> volume on the invoice and the <strong>chargeable</strong> volume the carrier says its terms require (it can include a minimum or rounding).
            </p>
            <p className="muted">
              <strong>CBM</strong> means cubic metres: length × width × height in metres. A parcel of 120 × 34 × 22 cm is 0.08976 CBM. Freight is often charged per CBM, so a small volume difference becomes a large amount.
            </p>
          </div>
        </div>
      </section>

      <section className="container section">
        <h2>What comes out</h2>
        <div className="cards">
          <div className="card">
            <h3>An editable complaint letter</h3>
            <p className="muted">Respectful, factual, and honest about what is unproven. It asks for the carrier’s calculation and terms. It never threatens or claims you are owed a refund.</p>
          </div>
          <div className="card">
            <h3>An evidence summary</h3>
            <p className="muted">Calculations with their formulas, findings with their status, a source map of every fact to a document location, open questions and a timeline.</p>
          </div>
          <div className="card">
            <h3>A record of what changed</h3>
            <p className="muted">Add a document and the earlier reading is kept as superseded, with a plain-language explanation of why the conclusion moved.</p>
          </div>
        </div>
      </section>

      <section className="container section">
        <div className="banner banner-info">
          <strong>What Counterbill does not do.</strong> It is not legal advice. It does not determine liability, guarantee a refund, call anyone fraudulent, or send complaints. Every letter is a draft you review and send yourself.
        </div>
        <p className="muted" style={{ marginTop: 12 }}>
          The sample cases are based on public reports by the Nigerian Shippers’ Council. The underlying invoices were not published, so the invoice and packing list in the main sample are reconstructions and are labelled that way everywhere, including in exports.{' '}
          <Link href="/demo">See the sources</Link>.
        </p>
      </section>
    </>
  );
}
