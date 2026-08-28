import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { notifyLibraryReply } from '@/lib/notifications';
import { toPublicAuthor } from '@/lib/user-identity';
import { getDocComments } from '@/lib/library-queries';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;

const createSchema = z.object({
  bodyMd: z.string().trim().min(1, '评论不能为空').max(10_000),
  parentId: z.string().optional(),
  // Transient reply-target inside the thread — routes notifications only,
  // never stored (feedback board contract).
  replyToId: z.string().optional(),
});

async function loadDoc(id: string) {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id },
    select: { id: true, slug: true, title: true, uploaderId: true, status: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt || doc.status !== 'ready') return null;
  return doc;
}

// GET /api/library/docs/[id]/comments (login) — full 2-level threads.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const canSeeIdentity = can(session.user, 'identity');
  const threads = (await getDocComments(doc.id, session.user.id)).map((c) => ({
    ...c,
    author: toPublicAuthor(c.author, canSeeIdentity),
    replies: c.replies.map((r) => ({ ...r, author: toPublicAuthor(r.author, canSeeIdentity) })),
  }));
  return NextResponse.json({ comments: threads });
}

// POST /api/library/docs/[id]/comments (login) — create comment / reply.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:comment:${session.user.id}`, 10, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '评论过于频繁，请稍后再试' },
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

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { bodyMd, parentId, replyToId } = parsed.data;

  // parentId must be a visible top-level comment of this doc.
  let parent: { id: string; authorId: string } | null = null;
  if (parentId) {
    const row = await prisma.libraryComment.findUnique({
      where: { id: parentId },
      select: { id: true, authorId: true, docId: true, parentId: true, status: true },
    });
    if (!row || row.docId !== doc.id || row.parentId !== null || row.status === 'deleted') {
      return NextResponse.json({ error: 'invalid_parent' }, { status: 400 });
    }
    parent = { id: row.id, authorId: row.authorId };
  }

  // replyToId (when present) must live inside the same thread.
  let replyTarget: { authorId: string; parentId: string | null } | null = null;
  if (replyToId && parent) {
    const row = await prisma.libraryComment.findUnique({
      where: { id: replyToId },
      select: { authorId: true, docId: true, parentId: true, id: true },
    });
    if (row && row.docId === doc.id && (row.id === parent.id || row.parentId === parent.id)) {
      replyTarget = { authorId: row.authorId, parentId: row.parentId };
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const comment = await tx.libraryComment.create({
      data: {
        docId: doc.id,
        authorId: session.user.id,
        parentId: parent?.id ?? null,
        bodyMd,
      },
      select: { id: true, bodyMd: true, parentId: true, createdAt: true },
    });
    await tx.libraryDoc.update({
      where: { id: doc.id },
      data: { commentCount: { increment: 1 } },
    });
    if (parent) {
      await tx.libraryComment.update({
        where: { id: parent.id },
        data: { replyCount: { increment: 1 } },
      });
    }
    return comment;
  });

  // Best-effort notifications, never blocking the write.
  const actorName = session.user.displayName;
  if (parent) {
    const target = replyTarget ?? { authorId: parent.authorId, parentId: null };
    void notifyLibraryReply({
      recipientId: target.authorId,
      actorId: session.user.id,
      actorName,
      docSlug: doc.slug,
      docTitle: doc.title,
      focusId: created.id,
      bodyMd,
      isReplyToComment: true,
    }).catch(() => undefined);
  } else {
    void notifyLibraryReply({
      recipientId: doc.uploaderId,
      actorId: session.user.id,
      actorName,
      docSlug: doc.slug,
      docTitle: doc.title,
      focusId: created.id,
      bodyMd,
      isReplyToComment: false,
    }).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, comment: created });
}
