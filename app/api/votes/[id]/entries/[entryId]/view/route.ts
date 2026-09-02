import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { recordVoteEntryView } from '@/lib/vote-queries';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/votes/[id]/entries/[entryId]/view (login) — the gallery pings this
// once per lightbox open. Server-side the VoteEntryVisit sessionHash dedupes to
// one view per viewer per work per UTC day, so re-opening or bouncing between
// works with ←/→ never inflates the number.
//
// 计数闸门必须与阅读闸门一致（zone post view route 的家法）：草稿活动、隐藏或
// 未过审的作品都不该累计公开浏览 —— 未过审作品只有投稿人自己看得见，让它涨
// 浏览数是没有意义的。/votes 本身是 layout 登录墙，所以 viewerKey 恒为 userId，
// 没有可伪造的匿名 IP key。
export async function POST(
  _req: Request,
  { params }: { params: { id: string; entryId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`votes:entryview:${session.user.id}`, 240, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const activity = await prisma.voteActivity.findUnique({
    where: { id: params.id },
    select: { id: true, deletedAt: true, status: true, creatorId: true },
  });
  if (!activity || activity.deletedAt || activity.status === 'draft') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // 发起人自己翻看作品不计数 —— 浏览数是给发起人读的运营数字，把他自己审稿、
  // 逐件核对的那些打开算进去，读到的就有一半是自己的痕迹。其他人（含站点
  // 管理员）照常计数：他们同时也是普通看客，区别对待反而让数字讲不清。
  if (session.user.id === activity.creatorId) {
    return NextResponse.json({ ok: true, counted: false, reason: 'self' });
  }

  const entry = await prisma.voteEntry.findUnique({
    where: { id: params.entryId },
    select: { id: true, activityId: true, hidden: true, status: true },
  });
  // 同时校验作品确实属于 URL 里的活动 —— 否则别的活动的 id 也能从这里计数。
  if (!entry || entry.activityId !== activity.id || entry.hidden || entry.status !== 'approved') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const counted = await recordVoteEntryView(entry.id, session.user.id);
  return NextResponse.json({ ok: true, counted });
}
