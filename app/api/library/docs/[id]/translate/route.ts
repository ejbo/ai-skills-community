import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// GET — whole-document 译文 status, for the reader to poll while a pass runs.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      uploaderId: true,
      visibility: true,
      deletedAt: true,
      translationLang: true,
      translationState: true,
      translationError: true,
    },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canReadDoc(doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    state: doc.translationState,
    lang: doc.translationLang,
    error: doc.translationError,
  });
}

// POST (any reader who may read the doc) — translate the WHOLE document.
//
// The result is stored and shared: whoever clicks 翻译全文 pays for it once and
// every later reader opens the 译文 instantly. Fire-and-forget, like indexing.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      uploaderId: true,
      visibility: true,
      deletedAt: true,
      status: true,
      translationState: true,
    },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (doc.status !== 'ready') return NextResponse.json({ error: 'not_ready' }, { status: 409 });
  if (!(await canReadDoc(doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (doc.translationState === 'running') {
    return NextResponse.json({ ok: true, state: 'running' });
  }

  // A whole-book pass is expensive; one start per user per hour is plenty.
  const gate = rateLimit(`library:translate-doc:${session.user.id}`, 5, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  void import('@/lib/library/translate-doc')
    .then((m) => m.runDocTranslation(doc.id, { force: true }))
    .catch(() => {});

  return NextResponse.json({ ok: true, state: 'running' });
}
