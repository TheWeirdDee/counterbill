import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DemoLauncher } from '@/components/DemoLauncher';
import { inferenceReadiness } from '@/server/config';
import { getDemoCase } from '@/server/demo';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = getDemoCase((await params).slug);
  return { title: d ? `Sample: ${d.title}` : 'Sample case' };
}

export default async function DemoCasePage({ params }: { params: Promise<{ slug: string }> }) {
  const d = getDemoCase((await params).slug);
  if (!d) notFound();
  const readiness = inferenceReadiness();
  return (
    <div className="container" style={{ paddingTop: 32, maxWidth: 860 }}>
      <p className="eyebrow">Sample case · {d.sampleLabel}</p>
      <h1>{d.title}</h1>
      <p className="lead muted">{d.summary}</p>

      <div className="banner banner-info" style={{ margin: '16px 0' }}>
        <strong>What is real and what is reconstructed.</strong> The figures below come from a public regulator report. {d.source.limitation} Every reconstructed or hypothetical document carries a visible label in the document list, the viewer, the findings and the exports.
      </div>

      <div className="card">
        <h2>The public facts</h2>
        <ul>
          {d.publicFacts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p className="muted">
          Source:{' '}
          <a href={d.source.url} target="_blank" rel="noopener noreferrer">
            {d.source.publisher}, “{d.source.title}”, {d.source.published}
          </a>
          . {d.source.verified}.
        </p>
      </div>

      <div className="card">
        <h2>What will happen when you start</h2>
        <ol>
          <li>A fresh case is created for your browser only, with the labelled starting documents.</li>
          <li>Evidence, Billing, Contract and Timeline agents start at the same moment; Case and Drafting agents react as results arrive.</li>
          <li>{d.steps.length ? 'You add the published evidence and watch the conclusion and the letter change, with the reason shown.' : 'You review the findings, questions and draft letter.'}</li>
          <li>You can open every source, edit the letter and download the PDF.</li>
        </ol>
        {!readiness.ready ? (
          <div className="banner banner-warn" role="status">
            <strong>Live investigations are not configured on this server.</strong> {readiness.message}
          </div>
        ) : readiness.mode === 'test' ? (
          <div className="banner banner-warn" role="status" style={{ marginBottom: 12 }}>
            <strong>Test mode.</strong> A deterministic stand-in replaces the language model on this server. Results are scripted, not live AI.
          </div>
        ) : (
          <p className="muted">
            Uses {readiness.model}. Sample runs call the model provider and are rate-limited per visitor.
          </p>
        )}
        <DemoLauncher slug={d.slug} />
      </div>
    </div>
  );
}
