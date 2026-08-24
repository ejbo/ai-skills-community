import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

// GET /api/library/docs/[id]/people (login) — who is reading (已加入书架) and
// who annotated (公开笔记), for the count-first popovers on the detail page.
// Readers appear only with their 阅读动态 privacy toggle on; annotators appear
// by virtue of their per-doc 公开笔记 opt-in.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: { id: true, shelfCount: true, status: true, visibility: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt || doc.status !== 'ready' || doc.visibility === 'private') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const canSeeIdentity = can(session.user, 'identity');
  const [shelfUsers, sharedNotes] = await Promise.all([
    prisma.libraryShelfItem.findMany({
      where: { docId: doc.id, user: { showLibraryActivity: true, isActive: true } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { user: AUTHOR_IDENTITY_SELECT },
    }),
    prisma.libraryHighlight.findMany({
      where: {
        docId: doc.id,
        user: { libraryProgress: { some: { docId: doc.id, shareNotes: true } }, isActive: true },
      },
      select: { user: AUTHOR_IDENTITY_SELECT },
    }),
  ]);

  const readers = shelfUsers.map((r) => toPublicAuthor(r.user, canSeeIdentity));

  const annotatorMap = new Map<string, { author: ReturnType<typeof toPublicAuthor>; count: number }>();
  for (const note of sharedNotes) {
    const author = toPublicAuthor(note.user, canSeeIdentity);
    const cur = annotatorMap.get(author.handle) ?? { author, count: 0 };
    cur.count += 1;
    annotatorMap.set(author.handle, cur);
  }
  const annotators = [...annotatorMap.values()].sort((a, b) => b.count - a.count).slice(0, 100);

  return NextResponse.json({
    // Total counts stay honest even when some users opted out of the roster.
    readerCount: doc.shelfCount,
    visibleReaders: readers,
    noteCount: sharedNotes.length,
    annotators,
  });
}
