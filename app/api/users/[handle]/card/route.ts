import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { loadProfileCardView } from '@/lib/profile/card-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/users/[handle]/card — the hover 名片 (ProfileCardView).
//
// Built by the SAME helper as the profile page hero, so hovering a name can
// never show more than — or anything different from — the profile itself:
// 隐私账号 department/lab and @handle text trimmed unless the viewer holds
// `identity`, staff role names trimmed (publicRoleBadge), stats counted only for
// sections this viewer may open. Session-only: the hover card is a logged-in
// affordance; anonymous visitors get 401 and the client closes the popover.
export async function GET(_req: Request, { params }: { params: { handle: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const view = await loadProfileCardView(params.handle, {
    id: session.user.id,
    canSeeIdentity: can(session.user, 'identity'),
  });
  if (!view) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Per-viewer payload (identity trimming, hidden-section stats) — never shared-cacheable.
  return NextResponse.json(view, { headers: { 'cache-control': 'private, no-store' } });
}
