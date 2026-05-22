import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { resolvePageName, shouldLogPath } from '@/lib/page-visit';

const schema = z.object({ path: z.string().min(1).max(512) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: true, skipped: 'guest' });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success || !shouldLogPath(parsed.data.path)) {
    return NextResponse.json({ ok: true, skipped: 'filtered' });
  }

  await prisma.pageVisit.create({
    data: {
      userId: session.user.id,
      path: parsed.data.path,
      pageName: resolvePageName(parsed.data.path),
      referrer: req.headers.get('referer') ?? undefined,
      userAgent: req.headers.get('user-agent') ?? undefined,
      ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    },
  });
  await prisma.user.update({
    where: { id: session.user.id },
    data: { lastSeenAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
