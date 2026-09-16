import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { listDiscussionStream } from '@/lib/discussion-queries';
import { publicStreamItems } from '@/lib/discussion-views';

export const dynamic = 'force-dynamic';

// GET /api/discussion/stream?cursor=&limit=&q= — "load more" pages of the 全部
// tab (feed posts + forum topics merged by time). Readable anonymously, like
// the rest of 讨论区.
export async function GET(req: Request) {
  const session = await auth();
  const sp = new URL(req.url).searchParams;
  const { items, hasMore, nextCursor } = await listDiscussionStream({
    cursor: sp.get('cursor'),
    limit: Number(sp.get('limit') ?? 10),
    q: sp.get('q') ?? undefined,
    viewerId: session?.user?.id ?? null,
  });
  return NextResponse.json({
    items: publicStreamItems(items, can(session?.user, 'identity')),
    hasMore,
    nextCursor,
  });
}
