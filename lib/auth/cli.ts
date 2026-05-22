import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';

const TOKEN_PREFIX = 'scm_pat_';
const SECRET_BYTES = 32;

export async function issueToken(): Promise<{ raw: string; hash: string; prefix: string }> {
  const secret = crypto.randomBytes(SECRET_BYTES).toString('base64url');
  const raw = `${TOKEN_PREFIX}${secret}`;
  const hash = await bcrypt.hash(raw, 10);
  const prefix = raw.slice(0, 12);
  return { raw, hash, prefix };
}

export async function verifyCliToken(authHeader: string | null): Promise<{ userId: string; scopes: string[] } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const raw = authHeader.slice(7).trim();
  if (!raw.startsWith(TOKEN_PREFIX)) return null;
  const prefix = raw.slice(0, 12);
  const candidates = await prisma.cliToken.findMany({
    where: { tokenPrefix: prefix, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { user: { select: { id: true, isActive: true } } },
  });
  for (const c of candidates) {
    if (!c.user.isActive) continue;
    if (await bcrypt.compare(raw, c.tokenHash)) {
      await prisma.cliToken.update({ where: { id: c.id }, data: { lastUsedAt: new Date() } });
      return { userId: c.user.id, scopes: c.scopes };
    }
  }
  return null;
}
