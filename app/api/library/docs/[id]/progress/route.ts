import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const patchSchema = z.object({
  chapterIndex: z.number().int().min(0),
  scrollRatio: z.number().min(0).max(1),
  percent: z.number().min(0).max(100),
});

// PATCH /api/library/docs/[id]/progress (login) — throttled reading-progress
// pings from the reader (also flushed with keepalive on unload).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { chapterIndex, scrollRatio, percent } = parsed.data;
  // First ping from this member = one more 「读过」. Create-then-update rather than
  // upsert so the counter moves exactly once: two racing first pings both try
  // the create, the PK rejects the loser (P2002), only the winner increments.
  const userId = session.user.id;
  try {
    await prisma.$transaction([
      prisma.libraryProgress.create({ data: { userId, docId: doc.id, chapterIndex, scrollRatio, percent } }),
      prisma.libraryDoc.update({ where: { id: doc.id }, data: { readerCount: { increment: 1 } } }),
    ]);
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    await prisma.libraryProgress.update({
      where: { userId_docId: { userId, docId: doc.id } },
      data: { chapterIndex, scrollRatio, percent },
    });
  }

  return NextResponse.json({ ok: true });
}
