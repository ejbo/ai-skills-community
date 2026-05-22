import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.isAdmin) {
    redirect('/');
  }
  return session;
}

export async function requireUser() {
  const session = await auth();
  if (!session?.user) {
    redirect('/auth/login');
  }
  return session;
}
