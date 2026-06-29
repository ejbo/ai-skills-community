import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// All toggles, all optional — the client sends the full set but we accept partials.
const schema = z.object({
  inAppCommentReply: z.boolean().optional(),
  inAppAccessRequest: z.boolean().optional(),
  inAppAccessDecision: z.boolean().optional(),
  inAppAnnouncement: z.boolean().optional(),
  emailCommentReply: z.boolean().optional(),
  emailAccessRequest: z.boolean().optional(),
  emailAccessDecision: z.boolean().optional(),
  emailAnnouncement: z.boolean().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const pref = await prisma.notificationPreference.findUnique({ where: { userId: session.user.id } });
  return NextResponse.json({ pref });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const userId = session.user.id;
  const pref = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...parsed.data },
    update: parsed.data,
  });
  return NextResponse.json({ ok: true, pref });
}
