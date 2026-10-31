import Link from 'next/link';
import { PublicHeader } from '@/components/PublicHeader';
import { currentUser } from '@/server/auth';

export const dynamic = 'force-dynamic';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <>
      <PublicHeader signedIn={!!user} />
      <main id="main">{children}</main>
      <footer className="site-footer">
        <div className="container">
          <p>
            <strong>Counterbill</strong> helps you compare freight records and prepare a complaint draft. It is not legal advice, it does not decide who is right, and it never sends a complaint for you.
          </p>
          <p>
            Uploaded shipment documents may be processed by the AI model provider configured for this deployment to investigate your case. Sample cases use no private data.{' '}
            <Link href="/demo">See the sample cases</Link> · <Link href="/login">Sign in</Link>
          </p>
          <p>
            Regulatory facts in the samples come from public Nigerian Shippers’ Council reports (links on the <Link href="/demo">samples page</Link>). Reconstructed documents are always labelled.
          </p>
        </div>
      </footer>
    </>
  );
}
