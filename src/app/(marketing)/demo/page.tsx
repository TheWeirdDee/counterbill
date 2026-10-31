import type { Metadata } from 'next';
import Link from 'next/link';
import { SOURCE_CLASS_LABEL } from '@/domain/schemas';
import { inferenceReadiness } from '@/server/config';
import { DEMO_CASES } from '@/server/demo';

export const metadata: Metadata = { title: 'Sample cases', description: 'Run a real, isolated Counterbill investigation on cases drawn from published Nigerian Shippers’ Council reports.' };
export const dynamic = 'force-dynamic';

export default function DemoIndex() {
  const readiness = inferenceReadiness();
  return (
    <div className="container" style={{ paddingTop: 32 }}>
      <h1>Sample cases</h1>
      <p className="muted" style={{ maxWidth: '70ch' }}>
        Each run is fresh, private to your browser, and executed by the same Mozaik agents as a real case. The regulatory facts are from public reports; any document that does not exist publicly is reconstructed and labelled. No sign-up is needed.
      </p>
      {!readiness.ready ? (
        <div className="banner banner-warn" role="status" style={{ margin: '16px 0' }}>
          <strong>Live investigations are not configured on this server.</strong> {readiness.message}
        </div>
      ) : readiness.mode === 'test' ? (
        <div className="banner banner-warn" role="status" style={{ margin: '16px 0' }}>
          <strong>Test mode.</strong> This server is using a deterministic stand-in instead of a language model, so results are scripted and are not live AI.
        </div>
      ) : null}

      {DEMO_CASES.map((d) => (
        <article key={d.slug} className="card" style={{ marginTop: 16 }} aria-labelledby={`h-${d.slug}`}>
          <p className="eyebrow">{d.sampleLabel}</p>
          <h2 id={`h-${d.slug}`}>{d.title}</h2>
          <p>{d.summary}</p>
          <div className="two-col">
            <div>
              <h3>What the public report says</h3>
              <ul>
                {d.publicFacts.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: '0.88rem' }}>
                Source:{' '}
                <a href={d.source.url} rel="noopener noreferrer" target="_blank">
                  {d.source.publisher} — “{d.source.title}” ({d.source.published})
                </a>
                . {d.source.verified}. {d.source.limitation}
              </p>
            </div>
            <div>
              <h3>What you start with</h3>
              <ul>
                {d.initial.map((x) => (
                  <li key={x.file}>
                    {x.displayName} <span className="badge-recon">{x.label}</span>
                  </li>
                ))}
                <li>
                  A sample user statement <span className="badge-recon">{SOURCE_CLASS_LABEL.user_statement}</span>
                </li>
              </ul>
              {d.steps.length ? (
                <>
                  <h3>Evidence you can add during the run</h3>
                  <ul>
                    {d.steps.map((s) => (
                      <li key={s.id}>
                        {s.title}. <span className="muted">{s.description}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          </div>
          <div className="cta-row">
            <Link href={`/demo/${d.slug}`} className="btn btn-primary">
              Open this sample
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
