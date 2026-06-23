import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';

const profileSchema = z.object({
  displayName: z.string().min(2).max(64).optional(),
  bio: z.string().max(240).nullable().optional(),
  // Accepts an uploaded path ("/api/uploads/images/…"), an absolute URL, or "".
  avatarUrl: z
    .string()
    .max(2048)
    .refine((v) => v === '' || v.startsWith('/') || /^https?:\/\//.test(v), {
      message: 'must be an uploaded path or http(s) URL',
    })
    .nullable()
    .optional(),
});

const passwordSchema = z.object({
  current: z.string().min(1).optional(),
  next: z.string().min(8).max(128),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, handle: true, displayName: true, bio: true, avatarUrl: true, isAdmin: true, huaweiW3Id: true, huaweiW3Name: true },
  });
  return NextResponse.json({ user });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (parsed.data.displayName !== undefined) data.displayName = parsed.data.displayName;
  if (parsed.data.bio !== undefined) data.bio = parsed.data.bio || null;
  if (parsed.data.avatarUrl !== undefined) data.avatarUrl = parsed.data.avatarUrl || null;

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data,
    select: { id: true, displayName: true, bio: true, avatarUrl: true },
  });
  return NextResponse.json({ user: updated });
}

export async function PATCH(req: Request) {
  // Password change endpoint.
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // If user already has a password, require current to be correct.
  if (user.passwordHash) {
    if (!parsed.data.current) return NextResponse.json({ error: 'current_required' }, { status: 400 });
    const ok = await verifyPassword(parsed.data.current, user.passwordHash);
    if (!ok) return NextResponse.json({ error: 'wrong_password' }, { status: 401 });
  }
  const hash = await hashPassword(parsed.data.next);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: hash,
      authMethod: user.huaweiW3Id ? 'both' : 'password',
    },
  });
  return NextResponse.json({ ok: true });
}
