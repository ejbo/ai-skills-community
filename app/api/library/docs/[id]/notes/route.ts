import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { MEMBER_ROLE_KEY, can } from '@/lib/permissions';
import { toPublicAuthor } from '@/lib/user-identity';
import {
  canReadDoc,
  getMyNoteLikes,
  getSharedNotes,
  isAnnotationSort,
  libraryViewerFromSession,
} from '@/lib/library-queries';

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
  if (!(await canReadDoc(doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const chapterRaw = sp.get('chapter');
  const chapter = chapterRaw === null ? undefined : Number.parseInt(chapterRaw, 10);
  const sortRaw = sp.get('sort');
  const q = (sp.get('q') ?? '').trim().slice(0, 80);

  const rows = await getSharedNotes(doc.id, {
    chapterIndex: chapter !== undefined && Number.isFinite(chapter) ? chapter : undefined,
    sort: isAnnotationSort(sortRaw) ? sortRaw : 'position',
    q: q || undefined,
  });
  const likedIds = await getMyNoteLikes(
    session.user.id,
    rows.map((r) => r.id),
  );
  const canSeeIdentity = can(session.user, 'identity');
  const canModerate = can(session.user, 'library');

  // The author's ROLE is what marks an annotation as coming from a 专家 (or an
  // admin). `member` / no role carries no badge — only a named role does, so a
  // deployment creates 专家 in 管理后台 → 角色与权限 and assigns it.
  const roleOf = (u: { role: { key: string; name: string } | null }) =>
    u.role && u.role.key !== MEMBER_ROLE_KEY ? { key: u.role.key, name: u.role.name } : null;

  const mapReply = (r: {
    id: string;
    parentId: string | null;
    bodyMd: string;
    createdAt: Date;
    replyCount: number;
    author: Parameters<typeof toPublicAuthor>[0] & { role: { key: string; name: string } | null };
  }) => ({
    id: r.id,
    parentId: r.parentId,
    bodyMd: r.bodyMd,
    createdAt: r.createdAt,
    replyCount: r.replyCount,
    author: toPublicAuthor(r.author, canSeeIdentity),
    authorRole: roleOf(r.author),
  });

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
    likeCount: n.likeCount,
    likedByMe: likedIds.has(n.id),
    canModerate,
    createdAt: n.createdAt,
    author: toPublicAuthor(n.user, canSeeIdentity),
    authorRole: roleOf(n.user),
    replies: n.replies.map((r) => ({
      ...mapReply(r),
      children: r.children.map(mapReply),
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
