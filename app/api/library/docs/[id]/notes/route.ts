import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { toPublicAuthor } from '@/lib/user-identity';
import { canReadDoc, getSharedNotes } from '@/lib/library-queries';

export const dynamic = 'force-dynamic';

// GET /api/library/docs/[id]/notes (login, read-gated) — the community
// annotations sidebar: shared highlights/notes with reply threads.
// `?chapter=N` narrows to one chapter (in-text markers).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true, visibility: true, status: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt || doc.status !== 'ready') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const viewer = { id: session.user.id, isAdmin: session.user.isAdmin };
  if (!(await canReadDoc(doc, viewer))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const chapterRaw = new URL(req.url).searchParams.get('chapter');
  const chapter = chapterRaw === null ? undefined : Number.parseInt(chapterRaw, 10);

  const rows = await getSharedNotes(
    doc.id,
    chapter !== undefined && Number.isFinite(chapter) ? chapter : undefined,
  );
  const isAdmin = session.user.isAdmin;
  const notes = rows.map((n) => ({
    id: n.id,
    isMine: n.userId === session.user.id,
    chapterIndex: n.chapterIndex,
    charStart: n.charStart,
    charEnd: n.charEnd,
    quote: n.quote,
    color: n.color,
    noteText: n.noteText,
    replyCount: n.replyCount,
    createdAt: n.createdAt,
    author: toPublicAuthor(n.user, isAdmin),
    replies: n.replies.map((r) => ({
      id: r.id,
      bodyMd: r.bodyMd,
      createdAt: r.createdAt,
      author: toPublicAuthor(r.author, isAdmin),
    })),
  }));
  return NextResponse.json({ notes });
}

const shareSchema = z.object({ share: z.boolean() });

// POST /api/library/docs/[id]/notes (login) — toggle 公开我的笔记 for this doc
// (upserts the per-user progress row that carries the flag).
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = shareSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.libraryProgress.upsert({
    where: { userId_docId: { userId: session.user.id, docId: doc.id } },
    create: { userId: session.user.id, docId: doc.id, shareNotes: parsed.data.share },
    update: { shareNotes: parsed.data.share },
  });
  return NextResponse.json({ ok: true, share: parsed.data.share });
}
