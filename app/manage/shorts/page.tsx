import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/admin';
import { ShortsManager } from './ShortsManager';

export const dynamic = 'force-dynamic';

// 短视频管理 — /manage layout 已经 requireAdmin()。moderation 走会员路由
// (PATCH/DELETE /api/shorts/[id])，按字段分权 + logAdmin，与讨论管理同款。
export default async function ManageShortsPage() {
  await requirePermission('shorts');
  const rows = await prisma.video.findMany({
    where: { isShort: true, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      posterUrl: true,
      durationSec: true,
      viewCount: true,
      likeCount: true,
      commentCount: true,
      featured: true,
      createdAt: true,
      uploader: { select: { handle: true, displayName: true } },
    },
  });

  return (
    <ShortsManager
      items={rows.map((r) => ({
        id: r.id,
        title: r.title,
        summary: r.summary,
        posterUrl: r.posterUrl,
        durationSec: r.durationSec,
        viewCount: r.viewCount,
        likeCount: r.likeCount,
        commentCount: r.commentCount,
        featured: r.featured,
        createdAt: r.createdAt.toISOString(),
        uploaderName: r.uploader.displayName,
        uploaderHandle: r.uploader.handle,
      }))}
    />
  );
}
