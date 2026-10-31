import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoLauncher } from '@/components/DemoLauncher';
import { SOURCE_CLASS_LABEL } from '@/domain/schemas';
import { inferenceReadiness } from '@/server/config';
import { getDemoCase } from '@/server/demo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = getDemoCase((await params).slug);
  return { title: d ? d.title : 'Example case', description: d?.summary };
}

export default async function ExamplePage({ params }: { params: Promise<{ slug: string }> }) {
  const d = getDemoCase((await params).slug);
  if (!d) notFound();
  const readiness = inferenceReadiness();
  const reconstructed = d.initial.some((x) => x.sourceClass === 'reconstructed_demo');
  return (
    <>
      <section className="page-intro">
        <div className="grid-bg" aria-hidden="true" />
        <div className="container" style={{ maxWidth: 'var(--content-max)' }}>
          <p className="eyebrow">
            <Link href="/examples" style={{ color: 'inherit' }}>
              Example cases
            </Link>{' '}
            / {d.source.published}
          </p>
          <h1 style={{ maxWidth: '20ch' }}>{d.title}</h1>
          <div className="disclosure" style={{ marginTop: 14 }}>
            <span>Based on a published report.</span>
            {reconstructed ? <span>Some supporting documents are reconstructed for this example.</span> : null}
          </div>
        </div>
      </section>

      <div className="container">
        <div className="example-detail">
          <div>
            <h2>The case</h2>
            <p>{d.summary}</p>

            <h2>What the published report says</h2>
            <ul>
              {d.publicFacts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: 14 }}>
              Source:{' '}
              <a href={d.source.url} target="_blank" rel="noopener noreferrer">
                {d.source.publisher}, “{d.source.title}”, {d.source.published}
              </a>
              . {d.source.verified}.
            </p>

            <h2>What is real and what is reconstructed</h2>
            <p>{d.source.limitation}</p>
            <ul>
              {d.initial.map((x) => (
                <li key={x.file}>
                  {x.displayName} <span className="badge-recon">{x.label}</span>
                </li>
              ))}
              <li>
                A short statement of the concern, in the user’s voice <span className="badge-recon">{SOURCE_CLASS_LABEL.user_statement}</span>
              </li>
            </ul>
            <p>Every reconstructed or hypothetical document keeps its label in the document list, the viewer, the findings and the exports.</p>

            {d.steps.length ? (
              <>
                <h2>Evidence you can add during the run</h2>
                <ul>
                  {d.steps.map((s) => (
                    <li key={s.id}>
                      <b>{s.title}.</b> {s.description}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <h2>What happens when you start</h2>
            <ol>
              <li>A fresh case is created for your browser only, with the labelled starting documents.</li>
              <li>The Evidence, Billing, Contract and Timeline agents start together; the Case and Drafting agents react as results arrive.</li>
              <li>{d.steps.length ? 'You add the published evidence and watch the conclusion and the letter change, with the reason shown.' : 'You review the findings, questions and draft letter.'}</li>
              <li>You can open every source, edit the letter and download the PDF.</li>
            </ol>
          </div>

          <aside className="example-aside" aria-labelledby="start-h">
            <h2 id="start-h">Investigate this example</h2>
            {!readiness.ready ? (
              <div className="banner banner-warn" role="status" style={{ marginBottom: 12 }}>
                <strong>Investigations are not configured on this server.</strong> {readiness.message}
              </div>
            ) : readiness.mode === 'test' ? (
              <div className="banner banner-warn" role="status" style={{ marginBottom: 12 }}>
                <strong>Test mode.</strong> A scripted stand-in replaces the language model on this server. Results are not AI output.
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 14 }}>
                Runs with {readiness.model}. Each run calls the model provider, so runs are limited per visitor.
              </p>
            )}
            <DemoLauncher slug={d.slug} label="Start this example" />
          </aside>
        </div>
      </div>
    </>
  );
}
