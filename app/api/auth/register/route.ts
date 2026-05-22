import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, deriveHandle } from '@/lib/auth/password';

const schema = z.object({
  email: z.string().email().transform((v) => v.toLowerCase().trim()),
  password: z.string().min(8).max(128),
  displayName: z.string().min(2).max(64),
});

async function uniqueHandle(base: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await prisma.user.findUnique({ where: { handle: candidate } });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const { email, password, displayName } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: 'email_in_use' }, { status: 409 });
  }

  const handle = await uniqueHandle(deriveHandle(email));
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.create({
    data: {
      email,
      handle,
      displayName,
      passwordHash,
      authMethod: 'password',
    },
    select: { id: true, handle: true, email: true },
  });

  return NextResponse.json({ ok: true, user });
}
