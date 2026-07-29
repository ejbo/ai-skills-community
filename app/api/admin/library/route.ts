import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/admin/library (admin) — every doc including pending/failed/deleted,
// newest first, optional `?q=` filter, hard cap 200 rows.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.isAdmin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  const where: Prisma.LibraryDocWhereInput = {};
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { author: { contains: q, mode: 'insensitive' } },
      { siteName: { contains: q, mode: 'insensitive' } },
      { sourceUrl: { contains: q, mode: 'insensitive' } },
    ];
  }

  const docs = await prisma.libraryDoc.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      slug: true,
      title: true,
      author: true,
      docType: true,
      format: true,
      status: true,
      processingError: true,
      aiIndexState: true,
      aiError: true,
      featured: true,
      sourceUrl: true,
      siteName: true,
      fileSizeBytes: true,
      wordCount: true,
      chapterCount: true,
      shelfCount: true,
      likeCount: true,
      viewCount: true,
      deletedAt: true,
      createdAt: true,
      uploader: { select: { handle: true, displayName: true, avatarUrl: true } },
    },
  });

  return NextResponse.json({ docs });
}
