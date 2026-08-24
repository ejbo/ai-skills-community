import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { LLMConfigError } from '@/lib/llm';
import { canReadDoc, libraryViewerFromSession } from '@/lib/library-queries';
import { getLibraryProvider } from '@/lib/library/llm';
import {
  MAX_PASSAGE_CHARS,
  normalizeSource,
  sourceHash,
  targetLangFor,
  translateWithCache,
} from '@/lib/library/translation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const schema = z.object({
  docId: z.string().min(1),
  text: z.string().trim().min(1).max(MAX_PASSAGE_CHARS),
});

// POST /api/library/translate (login) — selection translation for the reader.
//
// Cache-FIRST: a passage any reader already translated comes straight out of
// LibraryTranslation, so the second person to look at it waits for nothing.
// Direction is fixed per document (中文 doc → English, otherwise → 中文), which
// is also what the whole-document pass writes, so both share the same rows.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const doc = await prisma.libraryDoc.findUnique({
    where: { id: parsed.data.docId },
    select: { id: true, uploaderId: true, visibility: true, language: true, deletedAt: true },
  });
  if (!doc || doc.deletedAt) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!(await canReadDoc(doc, libraryViewerFromSession(session)))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const targetLang = targetLangFor(doc.language);
  const source = normalizeSource(parsed.data.text);
  if (!source) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  // Serve a cache hit without spending rate-limit budget or touching the model.
  const hit = await prisma.libraryTranslation.findUnique({
    where: {
      docId_targetLang_sourceHash: {
        docId: doc.id,
        targetLang,
        sourceHash: sourceHash(source),
      },
    },
    select: { text: true },
  });
  if (hit) return NextResponse.json({ ok: true, translation: hit.text, cached: true });

  const gate = rateLimit(`library:translate:${session.user.id}`, 60, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  let provider;
  try {
    provider = (await getLibraryProvider()).provider;
  } catch (e) {
    if (e instanceof LLMConfigError) {
      return NextResponse.json({ error: 'llm_unconfigured', reason: e.message }, { status: 503 });
    }
    throw e;
  }

  try {
    const { bySource } = await translateWithCache({
      docId: doc.id,
      targetLang,
      passages: [source],
      provider,
    });
    const translation = bySource.get(source);
    if (!translation) return NextResponse.json({ error: 'llm_no_result' }, { status: 502 });
    return NextResponse.json({ ok: true, translation, cached: false });
  } catch (e) {
    return NextResponse.json(
      { error: 'llm_error', reason: (e as Error).message.slice(0, 200) },
      { status: 502 },
    );
  }
}
