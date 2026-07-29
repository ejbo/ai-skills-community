import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getPostCommentThread } from '@/lib/discussion-queries';
import { toPublicAuthor } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

// GET /api/discussion/comments/[id]/context
// Resolves a deep-linked comment id (?focus= from a notification) to its
// thread root so the client can ensure the root is loaded and (for a reply)
// auto-expand the thread before scrolling. Mirrors the video board's
// /api/videos/[slug]/comments/[id]/context contract.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const target = await prisma.postComment.findUnique({
    where: { id: params.id },
    select: { id: true, parentId: true, postId: true },
  });
  if (!target) return NextResponse.json({ exists: false });

  const rootId = target.parentId ?? target.id;
  const root = await getPostCommentThread(rootId, session.user.id);
  const adm = session.user.isAdmin;
  return NextResponse.json({
    exists: true,
    postId: target.postId,
    rootId,
    isReply: target.parentId !== null,
    root: root
      ? {
          ...root,
          author: toPublicAuthor(root.author, adm),
          replies: root.replies.map((r) => ({ ...r, author: toPublicAuthor(r.author, adm) })),
        }
      : null,
  });
}
