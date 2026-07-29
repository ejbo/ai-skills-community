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

// POST /api/library/docs/[id]/shelf (login) — add to 我的书架.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userId = session.user.id;
  let shelfCount: number;
  try {
    const [, updated] = await prisma.$transaction([
      prisma.libraryShelfItem.create({ data: { userId, docId: doc.id } }),
      prisma.libraryDoc.update({
        where: { id: doc.id },
        data: { shelfCount: { increment: 1 } },
        select: { shelfCount: true },
      }),
    ]);
    shelfCount = updated.shelfCount;
  } catch (e) {
    // Already shelved: the unique-PK create fails and rolls the increment back
    // with it — a double-tap can never inflate the counter.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    const fresh = await prisma.libraryDoc.findUnique({
      where: { id: doc.id },
      select: { shelfCount: true },
    });
    shelfCount = fresh?.shelfCount ?? 0;
  }

  return NextResponse.json({ ok: true, shelved: true, shelfCount });
}

// DELETE /api/library/docs/[id]/shelf (login) — remove from 我的书架.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userId = session.user.id;
  // Guarded: only decrement when a row was actually deleted, so removing an
  // item that was never shelved (or racing deletes) can't drive the count negative.
  const shelfCount = await prisma.$transaction(async (tx) => {
    const r = await tx.libraryShelfItem.deleteMany({ where: { userId, docId: doc.id } });
    if (r.count === 0) {
      const fresh = await tx.libraryDoc.findUnique({
        where: { id: doc.id },
        select: { shelfCount: true },
      });
      return fresh?.shelfCount ?? 0;
    }
    const updated = await tx.libraryDoc.update({
      where: { id: doc.id },
      data: { shelfCount: { decrement: 1 } },
      select: { shelfCount: true },
    });
    return updated.shelfCount;
  });

  return NextResponse.json({ ok: true, shelved: false, shelfCount });
}
