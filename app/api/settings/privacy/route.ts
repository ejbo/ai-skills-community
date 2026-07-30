import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { PROFILE_VISIBILITY_SELECT } from '@/lib/profile-queries';

export const dynamic = 'force-dynamic';

const schema = z.object({
  isPrivate: z.boolean().optional(),
  showLibraryActivity: z.boolean().optional(),
  // 个人主页板块可见性 (/users/[handle])
  showProfileSkills: z.boolean().optional(),
  showProfileDocs: z.boolean().optional(),
  showProfilePosts: z.boolean().optional(),
  showProfileComments: z.boolean().optional(),
  showProfileShelf: z.boolean().optional(),
  showProfileEvents: z.boolean().optional(),
});

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
      ...PROFILE_VISIBILITY_SELECT,
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
