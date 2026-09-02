import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { listPosts } from '@/lib/discussion-queries';
import { mediaArraySchema, mediaKeysAvailable, resolveMedia } from '@/lib/discussion-media';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';
import { notifyMentions } from '@/lib/mention-notify';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// GET /api/discussion/posts?cursor=&limit=&sort= — feed "load more" pages.
export async function GET(req: Request) {
  const session = await auth();
  const sp = new URL(req.url).searchParams;
  const { items, hasMore, nextCursor } = await listPosts({
    cursor: sp.get('cursor'),
    limit: Number(sp.get('limit') ?? 10),
    sort: sp.get('sort') === 'hot' ? 'hot' : 'new',
    viewerId: session?.user?.id ?? null,
  });
  const canSeeIdentity = can(session?.user, 'identity');
  return NextResponse.json({
    items: items.map((p) => ({ ...p, author: toPublicAuthor(p.author, canSeeIdentity) })),
    hasMore,
    nextCursor,
  });
}

const createSchema = z.object({
  bodyMd: z.string().max(8000).default(''),
  media: mediaArraySchema,
});

// POST /api/discussion/posts — publish a feed post.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:post:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: await apiReason('rate_limited_post') },
      { status: 429 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? (await apiReason('invalid_request')) },
      { status: 400 },
    );
  }

  const bodyMd = parsed.data.bodyMd.trim();
  const media = resolveMedia(parsed.data.media);
  if (!media) {
    return NextResponse.json(
      { error: 'invalid_input', reason: await apiReason('media_invalid') },
      { status: 400 },
    );
  }
  if (!bodyMd && media.length === 0) {
    return NextResponse.json(
      { error: 'invalid_input', reason: await apiReason('empty_post') },
      { status: 400 },
    );
  }
  if (!(await mediaKeysAvailable(media))) {
    return NextResponse.json(
      { error: 'invalid_input', reason: await apiReason('media_in_use') },
      { status: 400 },
    );
  }

  const created = await prisma.post.create({
    data: {
      authorId: session.user.id,
      bodyMd,
      media: { create: media },
    },
    select: {
      id: true,
      bodyMd: true,
      pinned: true,
      likeCount: true,
      commentCount: true,
      editedAt: true,
      createdAt: true,
      author: AUTHOR_IDENTITY_SELECT,
      media: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          kind: true,
          url: true,
          posterUrl: true,
          name: true,
          mimeType: true,
          sizeBytes: true,
          width: true,
          height: true,
          sortOrder: true,
        },
      },
    },
  });

  // @人 — 讨论区 is readable by every member (the feed is not login-walled at
  // all), so a feed post needs no visibility gate. Best-effort, never blocks.
  void notifyMentions({
    bodyMd,
    actorId: session.user.id,
    actorName: session.user.displayName,
    site: { what: '动态', link: `/discussion/posts/${created.id}` },
  });

  return NextResponse.json({
    ok: true,
    post: {
      ...created,
      author: toPublicAuthor(created.author, can(session.user, 'identity')),
      myReaction: null,
      reactions: [],
    },
  });
}
