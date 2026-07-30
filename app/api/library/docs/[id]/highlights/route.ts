import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const MAX_HIGHLIGHTS_PER_DOC = 500;

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

const createSchema = z.object({
  chapterIndex: z.number().int().min(0),
  charStart: z.number().int().min(0),
  charEnd: z.number().int().min(0),
  quote: z.string().min(1, '划线内容不能为空').max(300),
  color: z.enum(['yellow', 'green', 'blue', 'pink']).default('yellow'),
  noteText: z.string().max(2000).optional(),
});

async function loadDoc(id: string) {
  const doc = await prisma.libraryDoc.findUnique({
    where: { id },
    select: { id: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return null;
  return doc;
}

// GET /api/library/docs/[id]/highlights (login) — the viewer's own highlights;
// `?chapter=N` narrows to one chapter (the 笔记 panel loads all).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const chapterRaw = new URL(req.url).searchParams.get('chapter');
  const chapter = chapterRaw === null ? null : Number.parseInt(chapterRaw, 10);

  const highlights = await prisma.libraryHighlight.findMany({
    where: {
      docId: doc.id,
      userId: session.user.id,
      ...(chapter !== null && Number.isFinite(chapter) ? { chapterIndex: chapter } : {}),
    },
    orderBy: [{ chapterIndex: 'asc' }, { charStart: 'asc' }],
    take: MAX_HIGHLIGHTS_PER_DOC,
    select: HIGHLIGHT_SELECT,
  });

  return NextResponse.json({ highlights });
}

// POST /api/library/docs/[id]/highlights (login) — create a highlight.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:highlight:${session.user.id}`, 60, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '操作过于频繁，请稍后再试' },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? '请求参数无效' },
      { status: 400 },
    );
  }

  const doc = await loadDoc(params.id);
  if (!doc) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const existing = await prisma.libraryHighlight.count({
    where: { docId: doc.id, userId: session.user.id },
  });
  if (existing >= MAX_HIGHLIGHTS_PER_DOC) {
    return NextResponse.json(
      { error: 'too_many', reason: '本文档的划线数量已达上限' },
      { status: 409 },
    );
  }

  const { noteText, ...fields } = parsed.data;
  const highlight = await prisma.libraryHighlight.create({
    data: {
      ...fields,
      noteText: noteText || null,
      docId: doc.id,
      userId: session.user.id,
    },
    select: HIGHLIGHT_SELECT,
  });

  return NextResponse.json({ ok: true, highlight });
}
