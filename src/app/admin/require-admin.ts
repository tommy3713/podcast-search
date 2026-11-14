import { notFound } from 'next/navigation';
import { currentAdmin, type SessionUser } from '@/lib/auth';

// Admin pages don't exist for anyone else: a 404, the same as a mistyped URL
export async function requireAdmin(): Promise<SessionUser> {
  const admin = await currentAdmin();
  if (!admin) notFound();
  return admin;
}
