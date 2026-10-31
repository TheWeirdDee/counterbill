import type { Metadata } from 'next';
import Link from 'next/link';
import { inferenceReadiness } from '@/server/config';
import { DEMO_CASES } from '@/server/demo';

export const metadata: Metadata = {
  title: 'Example cases',
  description: 'Explore freight-bill disputes drawn from published Nigerian Shippers’ Council reports, and see how Counterbill compares the records.',
};
export const dynamic = 'force-dynamic';

export default function ExamplesIndex() {
  const readiness = inferenceReadiness();
  return (
    <>
      <section className="page-intro">
        <div className="grid-bg" aria-hidden="true" />
        <div className="container">
          <p className="eyebrow accent">Example cases</p>
          <h1>Freight disputes, from the public record.</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            Each example starts from a report published by a regulator. Open one to read the sources, then investigate your own copy of it with no sign-up.
          </p>
          {!readiness.ready ? (
            <div className="banner banner-warn" role="status" style={{ marginTop: 20, maxWidth: 760 }}>
              <strong>Investigations are not configured on this server.</strong> You can read the examples, but cannot run one. {readiness.message}
            </div>
          ) : readiness.mode === 'test' ? (
            <div className="banner banner-warn" role="status" style={{ marginTop: 20, maxWidth: 760 }}>
              <strong>Test mode.</strong> This server uses a scripted stand-in instead of a language model, so results are not AI output.
            </div>
          ) : null}
        </div>
      </section>

      <div className="container">
        <ul className="example-list" style={{ listStyle: 'none', padding: '8px 0 80px', margin: 0 }}>
          {DEMO_CASES.map((d) => {
            const reconstructed = d.initial.some((x) => x.sourceClass === 'reconstructed_demo');
            return (
              <li key={d.slug} style={{ display: 'flex' }}>
                <article className="example-card" style={{ width: '100%' }} aria-labelledby={`h-${d.slug}`}>
                  <div className="disclosure">
                    <span>Based on a published report.</span>
                    {reconstructed ? <span>Some supporting documents are reconstructed for this example.</span> : null}
                  </div>
                  <h2 id={`h-${d.slug}`}>{d.title}</h2>
                  <p className="muted" style={{ fontSize: 13.5 }}>
                    {d.source.publisher} · {d.source.published}
                  </p>
                  <p>{d.summary}</p>
                  <div className="figs">
                    {d.figures.map((f) => (
                      <div key={f.label}>
                        <b>{f.value}</b>
                        <span>{f.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grow" />
                  <div>
                    <Link href={`/examples/${d.slug}`} className="btn btn-primary" aria-label={`Explore this example: ${d.title}`}>
                      Explore this example
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
