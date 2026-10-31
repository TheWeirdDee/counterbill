import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { AppShell } from '@/components/AppShell';
import { currentUser } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) {
    const h = await headers();
    const next = h.get('x-pathname') ?? '/app';
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  return <AppShell user={{ displayName: user.displayName, email: user.email }}>{children}</AppShell>;
}
