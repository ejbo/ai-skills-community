import { notFound } from 'next/navigation';
import { formatDistanceToNowStrict } from 'date-fns';
import { auth } from '@/lib/auth';
import { getFeedbackDetail } from '@/lib/feedback-queries';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { BackButton } from '@/components/BackButton';
import { Avatar } from '@/components/Avatar';
import { UpvoteButton } from '../_components/UpvoteButton';
import { StatusBadge, CategoryChip } from '../_components/badges';
import { FeedbackActions } from '../_components/FeedbackActions';
import { FeedbackComments, type ThreadView } from '../_components/FeedbackComments';

export const dynamic = 'force-dynamic';

export default async function FeedbackDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { focus?: string };
}) {
  const session = await auth();
  const feedback = await getFeedbackDetail(params.id, session?.user?.id ?? null);
  if (!feedback) notFound();

  const viewer = session?.user
    ? { handle: session.user.handle, isAdmin: session.user.isAdmin }
    : null;
  const isAuthor = viewer?.handle === feedback.author.handle;

  const threads: ThreadView[] = feedback.comments.map((c) => ({
    id: c.id,
    bodyMd: c.bodyMd,
    status: c.status,
    replyCount: c.replyCount,
    createdAt: c.createdAt,
    author: c.author,
    replies: c.replies.map((r) => ({
      id: r.id,
      bodyMd: r.bodyMd,
      status: r.status,
      replyCount: r.replyCount,
      createdAt: r.createdAt,
      author: r.author,
    })),
  }));

  return (
    <div className="container max-w-4xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref="/feedback" />
      </div>

      <section className="space-y-5">
        <div className="flex items-start gap-4">
          <UpvoteButton
            feedbackId={feedback.id}
            initialCount={feedback.upvoteCount}
            initialUpvoted={feedback.upvotedByMe}
            size="lg"
          />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryChip category={feedback.category} />
              <StatusBadge status={feedback.status} />
            </div>
            <h1 className="break-words text-2xl font-semibold tracking-tight md:text-3xl">
              {feedback.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Avatar
                name={feedback.author.displayName}
                src={feedback.author.avatarUrl}
                size="xs"
                tone="subtle"
              />
              <span>{feedback.author.displayName}</span>
              <span>·</span>
              <span>{formatDistanceToNowStrict(feedback.createdAt, { addSuffix: true })}</span>
            </div>
          </div>
          <FeedbackActions
            feedbackId={feedback.id}
            status={feedback.status}
            isAdmin={Boolean(viewer?.isAdmin)}
            canDelete={isAuthor || Boolean(viewer?.isAdmin)}
          />
        </div>

        {feedback.bodyMd && (
          <div className="surface rounded-2xl p-5">
            <MarkdownRenderer content={feedback.bodyMd} />
          </div>
        )}

        <div className="border-t border-zinc-100 pt-5 dark:border-zinc-800/60">
          <FeedbackComments
            feedbackId={feedback.id}
            initialThreads={threads}
            currentUser={viewer}
            focusId={searchParams.focus}
          />
        </div>
      </section>
    </div>
  );
}
