import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePath, redactUserSpecificPath, resolvePageName, sanitizeReferrer, shouldLogPath } from '@/lib/page-visit';

const schema = z.object({ path: z.string().min(1).max(512) });

// `lastSeenAt` only ever feeds day-granularity 活跃用户 counts and the 最近活跃
// sort in /manage/users, but the tracker fires on EVERY navigation, soft navs
// included — so rewriting the User row each time was a pure write amplifier
// (and a row lock on the busiest table) for a value nothing reads that finely.
const LAST_SEEN_TTL_MS = 5 * 60 * 1000;

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

  // One round trip for both writes — they used to be two sequential awaits, i.e.
  // two pool checkouts on every single navigation in the app. `updateMany` (not
  // `update`) so a stale-enough guard can live in the WHERE: when it matches
  // nothing this is a no-op that touches no row, and it no longer throws P2025
  // if the account was deleted mid-session.
  const now = new Date();
  const staleBefore = new Date(now.getTime() - LAST_SEEN_TTL_MS);
  await prisma.$transaction([
    prisma.pageVisit.create({
      data: {
        userId: session.user.id,
        path: storedPath,
        pageName: resolvePageName(path),
        referrer: referrer ?? undefined,
        userAgent: req.headers.get('user-agent') ?? undefined,
        ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
      },
    }),
    prisma.user.updateMany({
      where: {
        id: session.user.id,
        OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: staleBefore } }],
      },
      data: { lastSeenAt: now },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
