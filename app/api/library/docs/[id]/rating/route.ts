import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const MINUTE_MS = 60 * 1000;

const putSchema = z.object({ rating: z.number().int().min(1).max(5) });

async function loadDoc(id: string) {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id },
    select: { id: true, status: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt || doc.status !== 'ready') return null;
  return doc;
}

async function recomputeRating(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  docId: string,
) {
  const agg = await tx.libraryRating.aggregate({
    where: { docId },
    _avg: { rating: true },
    _count: true,
  });
  const ratingCount = agg._count;
  const avgRating = ratingCount > 0 ? Math.round((agg._avg.rating ?? 0) * 10) / 10 : 0;
  await tx.libraryDoc.update({ where: { id: docId }, data: { ratingCount, avgRating } });
  return { ratingCount, avgRating };
}

// PUT /api/library/docs/[id]/rating (login) — set/update the viewer's 1-5 rating.
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:rating:${session.user.id}`, 30, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = await req.json().catch(() => null);
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.libraryRating.upsert({
      where: { userId_docId: { userId: session.user.id, docId: doc.id } },
      create: { userId: session.user.id, docId: doc.id, rating: parsed.data.rating },
      update: { rating: parsed.data.rating },
    });
    return recomputeRating(tx, doc.id);
  });

  return NextResponse.json({ ok: true, myRating: parsed.data.rating, ...result });
}

// DELETE /api/library/docs/[id]/rating (login) — clear the viewer's rating.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    await tx.libraryRating.deleteMany({
      where: { userId: session.user.id, docId: doc.id },
    });
    return recomputeRating(tx, doc.id);
  });

  return NextResponse.json({ ok: true, myRating: 0, ...result });
}
