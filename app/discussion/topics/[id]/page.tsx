import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getLocale, getTranslations } from 'next-intl/server';
import { relativeTime } from '@/lib/i18n-date';
import { Eye, MessageSquare } from 'lucide-react';
import { auth } from '@/lib/auth';
import { getTopicDetail, recordTopicView } from '@/lib/discussion-queries';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { BackButton } from '@/components/BackButton';
import { Avatar } from '@/components/Avatar';
import { DeptTag } from '@/components/DeptTag';
import { toPublicAuthor } from '@/lib/user-identity';
import Link from 'next/link';
import { PostMediaGallery } from '../../_components/PostMediaGallery';
import { TopicUpvoteButton } from '../../_components/TopicUpvoteButton';
import { TopicActions } from '../../_components/TopicActions';
import { CategoryChip, LockedBadge, PinnedBadge } from '../../_components/badges';
import { TopicReplies, type ReplyThreadView } from '../../_components/TopicReplies';

export const dynamic = 'force-dynamic';

export default async function TopicDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { focus?: string };
}) {
  const session = await auth();
  const topic = await getTopicDetail(params.id, session?.user?.id ?? null);
  if (!topic) notFound();
  const t = await getTranslations('discussion_pages');
  const tp = await getTranslations('profile');
  const locale = await getLocale();

  // One view per viewer per UTC day. Anonymous viewers are keyed by the
  // TRUSTED client address: x-real-ip is set by our nginx from $remote_addr;
  // the FIRST x-forwarded-for hop is client-forgeable (nginx appends, not
  // replaces), so fall back to the LAST hop instead.
  const h = headers();
  const clientIp =
    h.get('x-real-ip')?.trim() ||
    h
      .get('x-forwarded-for')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .pop() ||
    'anon';
  const viewerKey = session?.user?.id ?? `ip:${clientIp}`;
  await recordTopicView(topic.id, viewerKey);

  const viewer = session?.user
    ? { handle: session.user.handle, isAdmin: session.user.isAdmin }
    : null;
  const viewerIsAdmin = Boolean(viewer?.isAdmin);
  const isAuthor = viewer?.handle === topic.author.handle;
  const author = toPublicAuthor(topic.author, viewerIsAdmin);

  const threads: ReplyThreadView[] = topic.replies.map((c) => ({
    id: c.id,
    bodyMd: c.bodyMd,
    status: c.status,
    replyCount: c.replyCount,
    createdAt: c.createdAt,
    author: toPublicAuthor(c.author, viewerIsAdmin),
    replies: c.replies.map((r) => ({
      id: r.id,
      bodyMd: r.bodyMd,
      status: r.status,
      replyCount: r.replyCount,
      createdAt: r.createdAt,
      author: toPublicAuthor(r.author, viewerIsAdmin),
    })),
  }));

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref="/discussion?tab=forum" />
      </div>

      <section className="space-y-5">
        <div className="flex items-start gap-4">
          <TopicUpvoteButton
            topicId={topic.id}
            initialCount={topic.upvoteCount}
            initialUpvoted={topic.upvotedByMe}
            size="lg"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {topic.categories.map((c) => (
                <CategoryChip key={c} category={c} />
              ))}
              {topic.pinned && <PinnedBadge />}
              {topic.locked && <LockedBadge />}
            </div>
            <h1 className="break-words text-2xl font-semibold tracking-tight md:text-3xl">
              {topic.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Avatar name={author.displayName} src={author.avatarUrl} size="xs" tone="subtle" />
              <Link href={`/users/${author.handle}`} className="hover:underline">
                {author.displayName}
              </Link>
              <DeptTag department={author.department} lab={author.lab} />
              <span>·</span>
              <span>{relativeTime(topic.createdAt, locale)}</span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {tp('n_replies', { count: topic.replyCount })}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {/* Fetched before this visit's (possibly day-deduped) increment. */}
                {t('views_times', { count: topic.viewCount })}
              </span>
            </div>
          </div>
          <TopicActions
            topicId={topic.id}
            pinned={topic.pinned}
            locked={topic.locked}
            isAdmin={Boolean(viewer?.isAdmin)}
            isAuthor={isAuthor}
          />
        </div>

        {(topic.bodyMd || topic.media.length > 0) && (
          <div className="surface rounded-2xl p-5">
            {topic.bodyMd && <MarkdownRenderer content={topic.bodyMd} />}
            {/* 附件：上传视频内嵌播放、外链视频卡片、PDF 预览 / PPT·Word 下载 */}
            <PostMediaGallery media={topic.media} />
          </div>
        )}

        <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800/60">
          <TopicReplies
            topicId={topic.id}
            initialThreads={threads}
            currentUser={viewer}
            locked={topic.locked && !viewer?.isAdmin}
            focusId={searchParams.focus}
          />
        </div>
      </section>
    </div>
  );
}
