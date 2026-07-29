import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { listPostCommentReplies } from '@/lib/discussion-queries';
import { toPublicAuthor } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

// GET /api/discussion/comments/[id]/replies — the full reply list of one
// thread, loaded when "展开其余 N 条回复" is clicked (the thread preview only
// carries the first few).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();

  const root = await prisma.postComment.findUnique({
    where: { id: params.id },
    select: { id: true, parentId: true },
  });
  if (!root || root.parentId !== null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const replies = await listPostCommentReplies(root.id, session?.user?.id ?? null);
  const adm = Boolean(session?.user?.isAdmin);
  return NextResponse.json({
    replies: replies.map((r) => ({ ...r, author: toPublicAuthor(r.author, adm) })),
  });
}
