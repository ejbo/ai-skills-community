import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canReadDoc } from '@/lib/library-queries';

export const dynamic = 'force-dynamic';

async function loadDoc(id: string) {
  return prisma.libraryDoc.findUnique({
    where: { id },
    select: { id: true, uploaderId: true, visibility: true, status: true, deletedAt: true },
  });
}

// GET /api/library/docs/[id]/chat/history (login) — the viewer's saved
// conversation with this doc (last 100 messages, oldest first).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canReadDoc(doc, { id: session.user.id, isAdmin: session.user.isAdmin }))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const rows = await prisma.libraryChatMessage.findMany({
    where: { docId: doc.id, userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, role: true, content: true, citations: true, createdAt: true },
  });
  return NextResponse.json({ messages: rows.reverse() });
}

// DELETE — 清空对话.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  await prisma.libraryChatMessage.deleteMany({
    where: { docId: doc.id, userId: session.user.id },
  });
  return NextResponse.json({ ok: true });
}
