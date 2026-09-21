import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { translateItem } from '@/lib/translate/service';
import {
  MAX_BATCH_ITEMS,
  TRANSLATE_KINDS,
  isContentLang,
  isTranslateKind,
  translateItemKey,
  viewerLang,
  type TranslateOutcome,
} from '@/lib/translate/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
/** Requests, not items — the route is cache-only, so this only bounds DB work per viewer. */
const BATCHES_PER_MINUTE = 60;
/** Items resolved at once (each is one row read + one cache query). */
const PARALLEL = 6;
const NO_STORE = { 'cache-control': 'private, no-store' };

const schema = z.object({
  items: z.array(z.object({ kind: z.string().max(40), id: z.string().min(1).max(64) })).min(1).max(MAX_BATCH_ITEMS),
  target: z.string().max(5).optional(),
});

// POST /api/translate/batch — 自动翻译's fast path: everything that scrolled into view,
// answered FROM THE CACHE ONLY. It never calls the model (so it needs no model
// budget and an anonymous viewer may use it on public kinds); an item that is not
// cached yet comes back `pending`, and the client asks for those one at a time
// through POST /api/translate, where the rate limit and the model live.
//
//   { items: [{kind,id}] (≤ 30), target? } → { target, results: { 'kind:id': TranslateOutcome } }
//
// Every item still goes through its kind's loader — a per-item failure (404, too
// long) is that item's result and never fails the batch.
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (parsed.data.target !== undefined && !isContentLang(parsed.data.target)) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }
  const target = parsed.data.target ?? viewerLang(cookies().get('locale')?.value);

  const session = await auth();
  const viewer = session?.user ?? null;
  const who = viewer?.id ?? `ip:${req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',').pop()?.trim() ?? 'anon'}`;
  const gate = rateLimit(`translate:batch:${who}`, BATCHES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'translate_rate_limited' }, { status: 429 });

  // De-duplicate: a feed can mount the same item twice (pinned + in stream).
  const items = [...new Map(parsed.data.items.map((it) => [`${it.kind}:${it.id}`, it])).values()];
  const results: Record<string, TranslateOutcome> = {};

  for (let i = 0; i < items.length; i += PARALLEL) {
    await Promise.all(
      items.slice(i, i + PARALLEL).map(async ({ kind, id }) => {
        if (!isTranslateKind(kind)) return;
        const key = translateItemKey(kind, id);
        if (!viewer && !TRANSLATE_KINDS[kind].public) {
          results[key] = { status: 'error', error: 'unauthenticated' };
          return;
        }
        try {
          const { usedModel: _ignored, ...outcome } = await translateItem({ kind, id, viewer, target, allowModel: false });
          results[key] = outcome as TranslateOutcome;
        } catch {
          results[key] = { status: 'error', error: 'translate_failed' };
        }
      }),
    );
  }
  return NextResponse.json({ target, results }, { headers: NO_STORE });
}
