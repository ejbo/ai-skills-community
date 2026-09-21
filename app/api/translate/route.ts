import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { LLMConfigError } from '@/lib/llm';
import { rateLimit, releaseRateLimit } from '@/lib/rate-limit';
import { translateItem, type TranslateItemResult } from '@/lib/translate/service';
import { TRANSLATE_KINDS, isContentLang, isTranslateKind, viewerLang, type TranslateErrorCode } from '@/lib/translate/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
/** Model-backed translations per user per hour. Cache hits are never charged. */
const MISSES_PER_HOUR = 120;
const NO_STORE = { 'cache-control': 'private, no-store' };

const schema = z.object({
  kind: z.string().max(40),
  id: z.string().min(1).max(64),
  target: z.string().max(5).optional(),
});

const STATUS: Record<TranslateErrorCode, number> = {
  unauthenticated: 401,
  not_found: 404,
  translate_too_long: 413,
  translate_rate_limited: 429,
  translate_unavailable: 503,
  translate_failed: 502,
  invalid_input: 400,
};

/** `usedModel` is the route's own bookkeeping (was a rate-limit unit due?) — not part of the wire contract. */
function publicOutcome(result: TranslateItemResult) {
  const { usedModel: _internal, ...outcome } = result;
  return outcome;
}

function fail(error: TranslateErrorCode, extra?: Record<string, unknown>) {
  return NextResponse.json({ status: 'error', error, ...extra }, { status: STATUS[error], headers: NO_STORE });
}

// POST /api/translate — X-style on-demand translation of ONE item.
//
//   { kind: TranslateKind, id: string, target?: 'zh'|'en'|'fr' }   target defaults to the viewer's UI locale
//
// The client never sends TEXT: the kind's loader (lib/translate/sources.ts) reads
// the row and re-runs that surface's own read gate — "translatable exactly when
// readable" — so this cannot be used to read content, nor as a free translation
// API for arbitrary text.
//
// Order of business (mirrors /api/library/translate):
//   1. a CACHE-ONLY pass. A full hit is answered before the rate limiter and
//      before any provider is resolved — the second reader of anything pays nothing;
//   2. only a miss needs a signed-in viewer (anonymous traffic can never spend GPU:
//      public kinds answer 202 `pending`), a rate-limit unit and the model.
//
// → 200 { status:'ok', cached, target, sourceLang, fields, state:'ready'|'partial', engine }
//   200 { status:'same' | 'nothing' }     hide the link
//   202 { status:'pending' }              anonymous + not cached yet
//   401 / 404 / 413 / 429 / 502 / 503     { status:'error', error }
export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isTranslateKind(parsed.data.kind)) return fail('invalid_input');
  const { kind, id } = parsed.data;
  if (parsed.data.target !== undefined && !isContentLang(parsed.data.target)) return fail('invalid_input');
  const target = parsed.data.target ?? viewerLang(cookies().get('locale')?.value);

  const session = await auth();
  const viewer = session?.user ?? null;
  if (!viewer && !TRANSLATE_KINDS[kind].public) return fail('unauthenticated');

  const first = await translateItem({ kind, id, viewer, target, allowModel: false });
  if (first.status === 'error') return fail(first.error);
  if (first.status !== 'pending') return NextResponse.json(publicOutcome(first), { headers: NO_STORE });

  if (!viewer) return NextResponse.json({ status: 'pending' }, { status: 202, headers: NO_STORE });

  const key = `translate:${viewer.id}`;
  const gate = rateLimit(key, MISSES_PER_HOUR, HOUR_MS);
  if (!gate.allowed) {
    const retryAfter = Math.max(1, Math.ceil((gate.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { status: 'error', error: 'translate_rate_limited', resetAt: gate.resetAt },
      { status: 429, headers: { ...NO_STORE, 'retry-after': String(retryAfter) } },
    );
  }

  try {
    const result = await translateItem({ kind, id, viewer, target, allowModel: true });
    if (result.status === 'error') {
      // The viewer got nothing for this unit of budget — give it back.
      releaseRateLimit(key);
      return fail(result.error);
    }
    return NextResponse.json(publicOutcome(result), { headers: NO_STORE });
  } catch (e) {
    releaseRateLimit(key);
    if (e instanceof LLMConfigError) return fail('translate_unavailable');
    return fail('translate_failed');
  }
}
