import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/admin';
import { voteOver } from '@/lib/votes/shared';
import { VotesManager, type VoteAdminRow } from './VotesManager';

export const dynamic = 'force-dynamic';

// /manage/votes — 投票活动管理（精选 / 删除）。Auth 已由 /manage/layout.tsx 的
// requireAdmin() 把守；本页只查数据。
export default async function ManageVotesPage() {
  await requirePermission('votes');
  const rows = await prisma.voteActivity.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      title: true,
      status: true,
      startAt: true,
      endAt: true,
      closedAt: true,
      featured: true,
      entryCount: true,
      voteCount: true,
      voterCount: true,
      createdAt: true,
      creator: { select: { displayName: true, handle: true } },
    },
  });

  const items: VoteAdminRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    over: voteOver(r),
    endAt: r.endAt?.toISOString() ?? null,
    featured: r.featured,
    entryCount: r.entryCount,
    voteCount: r.voteCount,
    voterCount: r.voterCount,
    createdAt: r.createdAt.toISOString(),
    creatorName: r.creator.displayName,
    creatorHandle: r.creator.handle,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">投票活动</h2>
        <span className="text-xs text-muted">共 {items.length} 个（最多显示 200）</span>
      </div>
      <VotesManager items={items} />
    </div>
  );
}
