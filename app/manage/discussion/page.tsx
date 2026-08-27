import { format } from 'date-fns';
import { requirePermission } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { discussionTagMap } from '@/lib/discussion-queries';
import { DiscussionManager } from './DiscussionManager';

export const dynamic = 'force-dynamic';

// 讨论管理 — recent feed posts + forum topics with inline moderation (pin /
// lock / delete). Same server-query → mapped-props → client-table shape as
// /manage/packs; mutations go through the member-facing routes, which already
// enforce isAdmin + logAdmin for moderation actions.
export default async function AdminDiscussionPage() {
  await requirePermission('discussion');
  const [posts, topics, tagMap] = await Promise.all([
    prisma.post.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        bodyMd: true,
        pinned: true,
        likeCount: true,
        commentCount: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true } },
        media: { select: { kind: true } },
      },
    }),
    prisma.discussionTopic.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        title: true,
        categories: true,
        pinned: true,
        locked: true,
        upvoteCount: true,
        replyCount: true,
        createdAt: true,
        author: { select: { handle: true, displayName: true } },
      },
    }),
    discussionTagMap(),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">讨论管理</h2>
      <DiscussionManager
        posts={posts.map((p) => ({
          id: p.id,
          excerpt: p.bodyMd.replace(/\s+/g, ' ').trim().slice(0, 80) || '（无文字，仅媒体）',
          pinned: p.pinned,
          likeCount: p.likeCount,
          commentCount: p.commentCount,
          mediaCount: p.media.length,
          createdAtText: format(p.createdAt, 'yyyy-MM-dd HH:mm'),
          author: p.author,
        }))}
        topics={topics.map((t) => ({
          id: t.id,
          title: t.title,
          // 管理后台是中文界面（见 CLAUDE.md），直接用分类的存储名 —— 成员
          // 自建分类没有 i18n key，只有名字。
          categoryNames: t.categories.map((slug) => tagMap.get(slug)?.name ?? slug),
          pinned: t.pinned,
          locked: t.locked,
          upvoteCount: t.upvoteCount,
          replyCount: t.replyCount,
          createdAtText: format(t.createdAt, 'yyyy-MM-dd HH:mm'),
          author: t.author,
        }))}
      />
    </div>
  );
}
