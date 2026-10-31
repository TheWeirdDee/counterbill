import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Workspace } from '@/components/workspace/Workspace';

export const metadata: Metadata = { title: 'Case' };
export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string; tab?: string[] }> }) {
  const { id, tab } = await params;
  if (tab && tab.length > 1) notFound();
  return <Workspace caseId={id} tab={tab?.[0] ?? ''} base={`/app/cases/${id}`} isDemo={false} />;
}
