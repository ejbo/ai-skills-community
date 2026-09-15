import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Account-level privacy switches only. 主页板块可见性 moved to
// `UserProfile.layout` (PUT /api/me/profile {layout}); the six legacy
// `User.showProfile*` flags are a read-only fallback now and are NEVER written.
// `.strict()` so a stale client still posting one gets a 400 instead of a
// silent no-op that toasts "已保存".
const schema = z
  .object({
    isPrivate: z.boolean().optional(),
    showLibraryActivity: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      isPrivate: true,
      showLibraryActivity: true,
      department: true,
      lab: true,
    },
  });
  return NextResponse.json({ ok: true, ...user });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  await prisma.user.update({ where: { id: session.user.id }, data });
  return NextResponse.json({ ok: true, ...data });
}
