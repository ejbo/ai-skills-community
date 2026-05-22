import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { issueToken } from '@/lib/auth/cli';

const createSchema = z.object({
  name: z.string().min(1).max(60),
  scopes: z.array(z.enum(['read', 'publish'])).default(['read', 'publish']),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const tokens = await prisma.cliToken.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ tokens });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const { raw, hash, prefix } = await issueToken();
  const token = await prisma.cliToken.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      tokenHash: hash,
      tokenPrefix: prefix,
      scopes: parsed.data.scopes,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
    select: { id: true, name: true, tokenPrefix: true, scopes: true, createdAt: true },
  });

  // Raw token is returned ONCE — user must copy it now.
  return NextResponse.json({ token: { ...token, raw } });
}
