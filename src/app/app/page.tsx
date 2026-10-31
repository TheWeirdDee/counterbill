import type { Metadata } from 'next';
import { Dashboard } from '@/components/Dashboard';

export const metadata: Metadata = { title: 'Your cases' };

export default function AppHome() {
  return <Dashboard />;
}
