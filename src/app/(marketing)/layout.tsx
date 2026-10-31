import { Footer } from '@/components/Footer';
import { PublicHeader } from '@/components/PublicHeader';
import { currentUser } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <>
      <PublicHeader signedIn={!!user} />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}
