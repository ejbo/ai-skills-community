import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const schema = z.object({ isPrivate: z.boolean() });

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isPrivate: true, department: true, lab: true },
  });
  return NextResponse.json({ ok: true, ...user });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { isPrivate: parsed.data.isPrivate },
  });
  return NextResponse.json({ ok: true, isPrivate: parsed.data.isPrivate });
}
