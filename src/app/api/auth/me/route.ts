import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';

export const GET = route(async () => {
  const user = await currentUser();
  return NextResponse.json({ user });
});
