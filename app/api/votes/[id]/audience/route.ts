import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { loadAudience } from '@/lib/audience';
import { findManagedActivity, voteViewerFromSession } from '@/lib/vote-queries';

export const dynamic = 'force-dynamic';

// GET /api/votes/[id]/audience (creator / `votes` admin) — the current 可见范围 and the
// 指定成员可见 list, for the gallery's 可见范围 dialog. Read fresh on open (the editor in
// another tab may have changed it). Saving goes through PATCH /api/votes/[id]
// { visibility, audienceUserIds } so the column and the list move in one transaction.
// Everyone else gets 404 — the list itself is the creator's business.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const viewer = voteViewerFromSession(session);
  const activity = await findManagedActivity(params.id, viewer);
  if (!activity) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    visibility: activity.visibility,
    audience: await loadAudience('vote', activity.id, viewer.canSeeIdentity),
  });
}
