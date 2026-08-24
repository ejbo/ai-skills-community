import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { getPostDetail } from '@/lib/discussion-queries';
import { BackButton } from '@/components/BackButton';
import { toPublicAuthor } from '@/lib/user-identity';
import { PostCard } from '../../_components/PostCard';
import type { CurrentUser } from '../../_components/types';

export const dynamic = 'force-dynamic';

// The shareable permalink page for one feed post. Notification deep links
// arrive here as /discussion/posts/<id>?focus=<commentId>.
export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { focus?: string };
}) {
  const session = await auth();
  const post = await getPostDetail(params.id, session?.user?.id ?? null);
  if (!post) notFound();

  const currentUser: CurrentUser | null = session?.user
    ? {
        handle: session.user.handle,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
        canModerate: can(session.user, 'discussion'),
      }
    : null;

  const { authorId: _authorId, ...rest } = post;
  const view = { ...rest, author: toPublicAuthor(post.author, can(session?.user, 'identity')) };

  return (
    <div className="container max-w-2xl py-8">
      <div className="mb-5">
        <BackButton fallbackHref="/discussion" />
      </div>
      <PostCard post={view} currentUser={currentUser} detail focusId={searchParams.focus} />
    </div>
  );
}
