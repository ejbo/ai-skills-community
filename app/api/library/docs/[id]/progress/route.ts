import { NextResponse } from 'next/server';
import { z } from 'zod';
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
  await prisma.libraryProgress.upsert({
    where: { userId_docId: { userId: session.user.id, docId: doc.id } },
    create: { userId: session.user.id, docId: doc.id, chapterIndex, scrollRatio, percent },
    update: { chapterIndex, scrollRatio, percent },
  });

  return NextResponse.json({ ok: true });
}
