import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

// POST /api/library/notes/[highlightId]/replies/[replyId]/like (login) — toggle.
// Same gate as liking the annotation itself: the document must be readable, and
// the annotation must actually be shared by its owner (an unshared 批注 is
// invisible, so its replies must be unlikeable too).
export async function POST(
  _req: Request,
  { params }: { params: { highlightId: string; replyId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:note-reply-like:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const reply = await prisma.libraryNoteReply.findUnique({
    where: { id: params.replyId },
    select: {
      id: true,
      status: true,
      highlightId: true,
      highlight: {
        select: {
          id: true,
          userId: true,
          doc: {
            select: { id: true, uploaderId: true, visibility: true, status: true, deletedAt: true },
          },
        },
      },
    },
  });
  if (
    !reply ||
    reply.status === 'deleted' ||
    reply.highlightId !== params.highlightId ||
    reply.highlight.doc.deletedAt ||
    reply.highlight.doc.status !== 'ready'
  ) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!(await canReadDoc(reply.highlight.doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (reply.highlight.userId !== session.user.id) {
    const shared = await prisma.libraryProgress.findUnique({
      where: { userId_docId: { userId: reply.highlight.userId, docId: reply.highlight.doc.id } },
      select: { shareNotes: true },
    });
    if (!shared?.shareNotes) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const key = { userId: session.user.id, replyId: reply.id };
  await prisma.$transaction(async (tx) => {
    const removed = await tx.libraryNoteReplyLike.deleteMany({ where: key });
    if (removed.count > 0) {
      await tx.libraryNoteReply.update({
        where: { id: reply.id },
        data: { likeCount: { decrement: removed.count } },
      });
      return;
    }
    const added = await tx.libraryNoteReplyLike.createMany({ data: [key], skipDuplicates: true });
    if (added.count > 0) {
      await tx.libraryNoteReply.update({
        where: { id: reply.id },
        data: { likeCount: { increment: added.count } },
      });
    }
  });

  const [fresh, mine] = await Promise.all([
    prisma.libraryNoteReply.findUnique({ where: { id: reply.id }, select: { likeCount: true } }),
    prisma.libraryNoteReplyLike.findUnique({
      where: { userId_replyId: key },
      select: { userId: true },
    }),
  ]);
  return NextResponse.json({
    ok: true,
    liked: Boolean(mine),
    likeCount: Math.max(0, fresh?.likeCount ?? 0),
  });
}
