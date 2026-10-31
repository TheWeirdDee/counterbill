import type { Metadata } from 'next';
import { DocsNav } from '@/components/DocsNav';
import { DOCS_NAV, DocsContent } from './sections';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'How to build a freight-bill case in Counterbill: supported files, reading sources, correcting facts, understanding discrepancies, exporting the complaint, and how the system works.',
};
export const dynamic = 'force-dynamic';

export default function DocsPage() {
  return (
    <div className="container">
      <div className="docs">
        <DocsNav groups={DOCS_NAV} />
        <article className="docs-body">
          <p className="eyebrow accent">Documentation</p>
          <h1>How Counterbill works</h1>
          <p className="lead" style={{ marginBottom: 0 }}>
            Task-by-task guidance first, then the technical internals. Each section has its own link.
          </p>
          <DocsContent />
        </article>
      </div>
    </div>
  );
}
