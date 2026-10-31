import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Workspace } from '@/components/workspace/Workspace';
import { getDemoCase } from '@/server/demo';

export const metadata: Metadata = { title: 'Sample investigation' };
export const dynamic = 'force-dynamic';

export default async function DemoWorkspacePage({ params }: { params: Promise<{ slug: string; caseId: string; tab?: string[] }> }) {
  const { slug, caseId, tab } = await params;
  if (!getDemoCase(slug) || (tab && tab.length > 1)) notFound();
  return <Workspace caseId={caseId} tab={tab?.[0] ?? ''} base={`/demo/${slug}/${caseId}`} isDemo />;
}
