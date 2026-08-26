import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { zoneSiteViewer } from '@/lib/zones/access';
import { resolveEmbed } from '@/lib/zones/embeds';
import { isEmbedKind, normalizeEmbedRef } from '@/lib/zones/shared';
import type { EmbedData } from '@/lib/zones/types';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
// EmbedCard / EmbedNodeView fetch one token each; a long post can mount dozens.
const EMBEDS_PER_MINUTE = 240;
// `link` is the only kind that makes the server fetch an ARBITRARY url (through
// the SSRF-guarded fetchPage), so it gets its own, much tighter budget than the
// in-DB kinds — otherwise the route is a 240/min outbound fetch primitive any
// logged-in user can drive. Kept above MAX_EMBEDS_PER_CONTENT (20) so one post
// full of link embeds still resolves inside a single window.
const LINK_EMBEDS_PER_MINUTE = 30;

// GET /api/zones/embed?kind=<EmbedKind>&ref=<ref> (login) → { embed: EmbedData }
// The source domain's own visibility gate is applied inside resolveEmbed; a
// ref the viewer may not see comes back as { ok: false, reason: 'forbidden' }
// (200), never as a leak of the underlying row.
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:embed:${session.user.id}`, EMBEDS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind');
  if (!isEmbedKind(kind)) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  if (kind === 'link') {
    const linkGate = rateLimit(`zones:embed-link:${session.user.id}`, LINK_EMBEDS_PER_MINUTE, MINUTE_MS);
    if (!linkGate.allowed) {
      return NextResponse.json({ error: 'rate_limited', resetAt: linkGate.resetAt }, { status: 429 });
    }
  }

  const rawRef = (sp.get('ref') ?? '').slice(0, 2048);
  const ref = normalizeEmbedRef(kind, rawRef);
  if (!ref) {
    const embed: EmbedData = { kind, ref: rawRef, ok: false, reason: 'invalid' };
    return NextResponse.json({ embed });
  }

  const locale = await getLocale();
  const embed = await resolveEmbed(kind, ref, { viewer: zoneSiteViewer(session.user), session, locale });
  return NextResponse.json({ embed });
}
