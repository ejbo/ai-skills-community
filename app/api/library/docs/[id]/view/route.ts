import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// POST /api/library/docs/[id]/view (public) — view ping from the detail page.
// Day-bucket dedupe: one LibraryView (and one viewCount tick) per visitor
// (userId, or hashed IP for anonymous) per doc per UTC day.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const userId = session?.user?.id ?? null;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const who = userId ?? createHash('sha256').update(ip).digest('hex').slice(0, 16);
  const day = new Date().toISOString().slice(0, 10);
  const sessionHash = createHash('sha256').update(`${who}:${doc.id}:${day}`).digest('hex');

  try {
    await prisma.$transaction([
      prisma.libraryView.create({ data: { docId: doc.id, userId, sessionHash } }),
      prisma.libraryDoc.update({
        where: { id: doc.id },
        data: { viewCount: { increment: 1 } },
      }),
    ]);
  } catch (e) {
    // Same visitor, same day: the unique(docId, sessionHash) create fails and
    // rolls the increment back with it — repeat opens never double-count.
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
  }

  return NextResponse.json({ ok: true });
}
