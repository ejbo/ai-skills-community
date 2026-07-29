import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

const HIGHLIGHT_SELECT = {
  id: true,
  chapterIndex: true,
  charStart: true,
  charEnd: true,
  quote: true,
  color: true,
  noteText: true,
  createdAt: true,
} as const;

const patchSchema = z.object({
  color: z.enum(['yellow', 'green', 'blue', 'pink']).optional(),
  noteText: z.string().max(2000).optional(),
});

async function loadOwnedHighlight(params: { id: string; highlightId: string }, userId: string) {
  const highlight = await prisma.libraryHighlight.findUnique({
    where: { id: params.highlightId },
    select: { id: true, docId: true, userId: true },
  });
  if (!highlight || highlight.docId !== params.id) return { error: 404 as const };
  if (highlight.userId !== userId) return { error: 403 as const };
  return { highlight };
}

// PATCH /api/library/docs/[id]/highlights/[highlightId] (owner) — change the
// color or the note (noteText '' clears it).
export async function PATCH(
  req: Request,
  { params }: { params: { id: string; highlightId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || (parsed.data.color === undefined && parsed.data.noteText === undefined)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const found = await loadOwnedHighlight(params, session.user.id);
  if ('error' in found) {
    return found.error === 404
      ? NextResponse.json({ error: 'not_found' }, { status: 404 })
      : NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const highlight = await prisma.libraryHighlight.update({
    where: { id: found.highlight.id },
    data: {
      ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
      ...(parsed.data.noteText !== undefined ? { noteText: parsed.data.noteText || null } : {}),
    },
    select: HIGHLIGHT_SELECT,
  });

  return NextResponse.json({ ok: true, highlight });
}

// DELETE /api/library/docs/[id]/highlights/[highlightId] (owner).
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; highlightId: string } },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const found = await loadOwnedHighlight(params, session.user.id);
  if ('error' in found) {
    return found.error === 404
      ? NextResponse.json({ error: 'not_found' }, { status: 404 })
      : NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const r = await prisma.libraryHighlight.deleteMany({
    where: { id: found.highlight.id, userId: session.user.id },
  });
  if (r.count === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
