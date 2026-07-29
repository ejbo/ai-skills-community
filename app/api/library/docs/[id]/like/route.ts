import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

async function loadDoc(id: string) {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return null;
  return doc;
}

// POST /api/library/docs/[id]/like (login) — like a doc.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userId = session.user.id;
  let likeCount: number;
  try {
    const [, updated] = await prisma.$transaction([
      prisma.libraryLike.create({ data: { userId, docId: doc.id } }),
      prisma.libraryDoc.update({
        where: { id: doc.id },
        data: { likeCount: { increment: 1 } },
        select: { likeCount: true },
      }),
    ]);
    likeCount = updated.likeCount;
  } catch (e) {
    // Duplicate like: the unique-PK create fails and rolls the increment back.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    const fresh = await prisma.libraryDoc.findUnique({
      where: { id: doc.id },
      select: { likeCount: true },
    });
    likeCount = fresh?.likeCount ?? 0;
  }

  return NextResponse.json({ ok: true, liked: true, likeCount });
}

// DELETE /api/library/docs/[id]/like (login) — remove the like.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userId = session.user.id;
  const likeCount = await prisma.$transaction(async (tx) => {
    const r = await tx.libraryLike.deleteMany({ where: { userId, docId: doc.id } });
    if (r.count === 0) {
      const fresh = await tx.libraryDoc.findUnique({
        where: { id: doc.id },
        select: { likeCount: true },
      });
      return fresh?.likeCount ?? 0;
    }
    const updated = await tx.libraryDoc.update({
      where: { id: doc.id },
      data: { likeCount: { decrement: 1 } },
      select: { likeCount: true },
    });
    return updated.likeCount;
  });

  return NextResponse.json({ ok: true, liked: false, likeCount });
}
