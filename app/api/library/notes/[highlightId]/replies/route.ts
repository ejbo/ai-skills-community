import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { notifyLibraryNoteReply } from '@/lib/notifications';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';

const MINUTE_MS = 60 * 1000;

const createSchema = z.object({
  bodyMd: z.string().trim().min(1, '回复不能为空').max(4000),
});

// POST /api/library/notes/[highlightId]/replies (login) — reply to a SHARED
// note in the reader's community sidebar.
export async function POST(req: Request, { params }: { params: { highlightId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:note-reply:${session.user.id}`, 15, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '回复过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
      { status: 400 },
    );
  }

  const highlight = await prisma.libraryHighlight.findUnique({
    where: { id: params.highlightId },
    select: {
      id: true,
      userId: true,
      chapterIndex: true,
      doc: {
        select: { id: true, slug: true, uploaderId: true, visibility: true, status: true, deletedAt: true },
      },
    },
  });
  if (!highlight || highlight.doc.deletedAt || highlight.doc.status !== 'ready') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!(await canReadDoc(highlight.doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  // Only notes their owner shares accept replies (own notes always do).
  if (highlight.userId !== session.user.id) {
    const shared = await prisma.libraryProgress.findUnique({
      where: { userId_docId: { userId: highlight.userId, docId: highlight.doc.id } },
      select: { shareNotes: true },
    });
    if (!shared?.shareNotes) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const [reply] = await prisma.$transaction([
    prisma.libraryNoteReply.create({
      data: {
        highlightId: highlight.id,
        authorId: session.user.id,
        bodyMd: parsed.data.bodyMd,
      },
      select: {
        id: true,
        bodyMd: true,
        createdAt: true,
        author: AUTHOR_IDENTITY_SELECT,
      },
    }),
    prisma.libraryHighlight.update({
      where: { id: highlight.id },
      data: { replyCount: { increment: 1 } },
    }),
  ]);

  void notifyLibraryNoteReply({
    recipientId: highlight.userId,
    actorId: session.user.id,
    actorName: session.user.displayName,
    docSlug: highlight.doc.slug,
    chapterIndex: highlight.chapterIndex,
    highlightId: highlight.id,
    bodyMd: parsed.data.bodyMd,
  }).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    reply: { ...reply, author: toPublicAuthor(reply.author, can(session.user, 'identity')) },
  });
}
