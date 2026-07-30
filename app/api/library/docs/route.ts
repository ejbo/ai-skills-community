import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { createDocFromUrl, IngestError } from '@/lib/library/ingest';
import { cleanCategories } from '@/lib/library/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

const createSchema = z.object({
  url: z.string().trim().min(4, '请输入链接').max(2048),
  docType: z
    .enum(['auto', 'book', 'paper', 'blog', 'article', 'report', 'other'])
    .default('auto'),
  categories: z.array(z.string()).max(8).default([]),
});

const INGEST_STATUS: Record<string, number> = {
  invalid_url: 400,
  fetch_failed: 502,
  too_large: 413,
  unsupported_content: 415,
};

// POST /api/library/docs (login) — submit a URL to the 知识库. Extraction runs
// inline (seconds); AI indexing is fired-and-forgotten inside ingest.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`library:submit:${session.user.id}`, 20, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '提交过于频繁，请稍后再试' },
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

  try {
    const result = await createDocFromUrl({
      url: parsed.data.url,
      uploaderId: session.user.id,
      docType: parsed.data.docType,
      categories: cleanCategories(parsed.data.categories),
    });
    return NextResponse.json({
      ok: true,
      doc: { id: result.id, slug: result.slug, status: result.status },
      existing: result.existing,
    });
  } catch (e) {
    if (e instanceof IngestError) {
      return NextResponse.json(
        { error: e.code, reason: e.message },
        { status: INGEST_STATUS[e.code] ?? 400 },
      );
    }
    console.error('[library] url ingest failed', e);
    return NextResponse.json({ error: 'ingest_failed' }, { status: 500 });
  }
}
