import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/library/docs/[id] (public) — minimal status poll for ProcessingPanel
// and AiDigest (extraction + AI indexing progress).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      slug: true,
      status: true,
      processingError: true,
      aiIndexState: true,
      chapterCount: true,
      deletedAt: true,
    },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: doc.id,
    slug: doc.slug,
    status: doc.status,
    processingError: doc.processingError,
    aiIndexState: doc.aiIndexState,
    chapterCount: doc.chapterCount,
  });
}
