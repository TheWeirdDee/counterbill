import { WorkspaceHeader } from '@/components/PublicHeader';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkspaceHeader />
      <main id="main">{children}</main>
    </>
  );
}
