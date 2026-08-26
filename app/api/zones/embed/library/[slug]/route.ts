import { NextResponse } from 'next/server';
import { getLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { zoneSiteViewer } from '@/lib/zones/access';
import { getLibraryPreview } from '@/lib/zones/embeds';

export const dynamic = 'force-dynamic';

const MINUTE_MS = 60 * 1000;
const PREVIEWS_PER_MINUTE = 120;

// GET /api/zones/embed/library/[slug]?ch=<n> (login)
//   → EmbedLibraryPreview (200) | 403 { error: 'no_access' } | 404
// The library's own gate decides: a restricted doc is discoverable (card) but
// its chapter text needs an approved access request; private docs are
// uploader/admin only. Mirrors getDocReaderData's rule — nothing weaker.
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:embed-library:${session.user.id}`, PREVIEWS_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) {
    return NextResponse.json({ error: 'rate_limited', resetAt: gate.resetAt }, { status: 429 });
  }

  const chRaw = Number.parseInt(new URL(req.url).searchParams.get('ch') ?? '0', 10);
  const chapterIndex = Number.isFinite(chRaw) && chRaw >= 0 ? chRaw : 0;

  const locale = await getLocale();
  const preview = await getLibraryPreview(params.slug, chapterIndex, {
    viewer: zoneSiteViewer(session.user),
    session,
    locale,
  });
  if (preview === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (preview === 'no_access') {
    return NextResponse.json(
      { error: 'no_access', reason: await apiReason('zone_library_no_access') },
      { status: 403 },
    );
  }
  return NextResponse.json(preview);
}
