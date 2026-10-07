import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';
import { effectivePassState, STALE_LOCK_MS } from '@/lib/library/translation-state';
import { isTargetLang, targetLangsFor, type TargetLang } from '@/lib/library/translation-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const DOC_SELECT = {
  id: true,
  uploaderId: true,
  visibility: true,
  deletedAt: true,
  status: true,
  language: true,
} as const;

/** The doc, if the session may read it — the 译文 of a doc is exactly as readable as the doc. */
async function readableDoc(id: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'unauthenticated' }, { status: 401 }) };
  const doc = await prisma.libraryDoc.findUnique({ where: { id }, select: DOC_SELECT });
  if (!doc || doc.deletedAt) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  if (!(await canReadDoc(doc, libraryViewerFromSession(session)))) {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  }
  return { session, doc };
}

function langFrom(raw: unknown, docLanguage: string | null): TargetLang | null {
  if (!isTargetLang(raw)) return null;
  return targetLangsFor(docLanguage).includes(raw) ? raw : null;
}

// GET ?lang=zh|en — that language's pass status plus the chapters that already
// have a translation, so the reader can swap a chapter in the moment it lands.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const r = await readableDoc(params.id);
  if ('error' in r) return r.error;
  const lang = langFrom(new URL(req.url).searchParams.get('lang'), r.doc.language);
  if (!lang) return NextResponse.json({ error: 'invalid_lang' }, { status: 400 });

  const [pass, rows] = await Promise.all([
    prisma.libraryDocTranslation.findUnique({
      where: { docId_targetLang: { docId: r.doc.id, targetLang: lang } },
      select: { state: true, error: true, heartbeatAt: true, finishedAt: true },
    }),
    prisma.libraryChapterTranslation.findMany({
      where: { targetLang: lang, chapter: { docId: r.doc.id } },
      select: { chapter: { select: { chapterIndex: true } } },
    }),
  ]);
  // A `running` row nobody has touched for the stale window is a crashed pass:
  // it reads as idle so the reader starts a fresh one (which re-claims it).
  return NextResponse.json({
    lang,
    state: effectivePassState(pass),
    error: pass?.error ?? null,
    /** Lets the reader tell THIS run's end from an earlier one's (same clock as POST's `at`). */
    finishedAt: pass?.finishedAt?.toISOString() ?? null,
    chapters: rows.map((row) => row.chapter.chapterIndex),
  });
}

const postSchema = z.object({
  lang: z.enum(['zh', 'en']),
  /** The chapter the reader is on — translated first. */
  startChapter: z.number().int().min(0).max(100_000).optional(),
});

// POST {lang, startChapter?} (any reader of the doc) — start / resume the
// `lang` pass. The reader calls this ON ITS OWN when the doc is opened in a
// language it has no translation for; the result is stored and shared, so the
// first reader pays and everyone after opens it instantly. Fire-and-forget.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const r = await readableDoc(params.id);
  if ('error' in r) return r.error;
  if (r.doc.status !== 'ready') return NextResponse.json({ error: 'not_ready' }, { status: 409 });

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const lang = langFrom(parsed.data.lang, r.doc.language);
  if (!lang) return NextResponse.json({ error: 'invalid_lang' }, { status: 400 });

  const pass = await prisma.libraryDocTranslation.findUnique({
    where: { docId_targetLang: { docId: r.doc.id, targetLang: lang } },
    select: { state: true, heartbeatAt: true },
  });
  const at = new Date().toISOString();
  if (pass?.state === 'running' && Date.now() - pass.heartbeatAt.getTime() <= STALE_LOCK_MS) {
    return NextResponse.json({ ok: true, state: 'running', at });
  }

  // Only a pass that actually STARTS spends budget — reopening a doc that is
  // already translated or translating never does. Generous: the reader starts
  // these automatically, one per untranslated doc a member opens.
  const gate = rateLimit(`library:translate-doc:${r.session.user.id}`, 40, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  void import('@/lib/library/translate-doc')
    .then((m) => m.runDocTranslation(r.doc.id, lang, { force: true, startChapter: parsed.data.startChapter }))
    .catch(() => {});

  return NextResponse.json({ ok: true, state: 'running', at });
}
