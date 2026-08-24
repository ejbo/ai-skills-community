import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePath, redactUserSpecificPath, resolvePageName, sanitizeReferrer, shouldLogPath } from '@/lib/page-visit';

const schema = z.object({ path: z.string().min(1).max(512) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ ok: true, skipped: 'guest' });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: true, skipped: 'filtered' });

  const path = normalizePath(parsed.data.path);
  if (!shouldLogPath(path)) return NextResponse.json({ ok: true, skipped: 'filtered' });

  // 管理员看了哪个用户的页面不留痕：staff viewers' visits to user-specific pages
  // keep the page NAME (用户详情 / 用户主页) but store the route template as the path.
  const staff = Boolean(session.user.isAdmin);
  const storedPath = staff ? (redactUserSpecificPath(path) ?? path) : path;
  // The Referer is the visited page's own full URL (query string included) — never
  // store it raw or it re-leaks exactly what `path` was redacted to hide.
  const referrer = sanitizeReferrer(req.headers.get('referer'), staff, process.env.NEXT_PUBLIC_BASE_PATH ?? '');

  await prisma.pageVisit.create({
    data: {
      userId: session.user.id,
      path: storedPath,
      pageName: resolvePageName(path),
      referrer: referrer ?? undefined,
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
