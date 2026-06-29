import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { getComment } from '@/lib/video/queries';

export const dynamic = 'force-dynamic';

// GET /api/videos/[slug]/comments/[id]/context
// Resolves a deep-linked comment id to its thread root so the client can ensure
// the root is loaded and (for a reply) auto-expand the thread before scrolling.
export async function GET(_req: Request, { params }: { params: { slug: string; id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const target = await prisma.videoComment.findFirst({
    where: { id: params.id, status: { not: 'hidden' } },
    select: { id: true, parentId: true },
  });
  if (!target) return NextResponse.json({ exists: false });

  const rootId = target.parentId ?? target.id;
  const root = await getComment(rootId, session.user.id);
  return NextResponse.json({
    exists: true,
    rootId,
    isReply: target.parentId !== null,
    root,
  });
}
