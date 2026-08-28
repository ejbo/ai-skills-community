import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Kept although it has no caller today: its only one was the self-service
 * registration route, closed on 2026-08-27. It is the documented handle rule
 * (and what every legacy password account's handle was built from), so an
 * admin create-user path should reuse this rather than reinvent it.
 */
export function deriveHandle(email: string): string {
  const local = email.split('@')[0] ?? 'user';
  return local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'user';
}
