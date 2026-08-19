import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { findManagedActivity, voteViewerFromSession } from '@/lib/vote-queries';
import { applyNameRule, parseNameRule } from '@/lib/votes/shared';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/votes/[id]/apply-rule (creator/admin) — save the filename parse
// rule and re-derive 作品名/作者/工号 for every entry the organizer has NOT
// hand-edited (titleEdited rows are never overwritten). Body: { rule } where
// rule matches VoteNameRule, or { rule: null } to just clear the stored rule.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`votes:rule:${session.user.id}`, 30, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const activity = await findManagedActivity(params.id, voteViewerFromSession(session));
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await req.json().catch(() => null)) as { rule?: unknown } | null;
  if (!body || !('rule' in body)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  if (body.rule === null) {
    await prisma.voteActivity.update({
      where: { id: activity.id },
      data: { nameRule: Prisma.DbNull },
    });
    return NextResponse.json({ ok: true, updated: 0 });
  }

  const rule = parseNameRule(body.rule);
  if (!rule) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const entries = await prisma.voteEntry.findMany({
    where: { activityId: activity.id, titleEdited: false },
    select: { id: true, originalName: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.voteActivity.update({
      where: { id: activity.id },
      data: { nameRule: rule as object },
    });
    for (const e of entries) {
      const parsed = applyNameRule(e.originalName, rule);
      await tx.voteEntry.update({
        where: { id: e.id },
        data: {
          title: parsed.title,
          authorName: parsed.authorName,
          authorNo: parsed.authorNo,
        },
      });
    }
  });

  return NextResponse.json({ ok: true, updated: entries.length });
}
