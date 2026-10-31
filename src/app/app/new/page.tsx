import type { Metadata } from 'next';
import { NewCaseWizard } from '@/components/NewCaseWizard';

export const metadata: Metadata = { title: 'New case' };

export default function NewCasePage() {
  return <NewCaseWizard />;
}
