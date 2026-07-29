import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { listPosts } from '@/lib/discussion-queries';
import { imagePublicUrl } from '@/lib/uploads/image-storage';
import { postMediaPublicUrl } from '@/lib/uploads/post-media-storage';
import { AUTHOR_IDENTITY_SELECT, toPublicAuthor } from '@/lib/user-identity';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// GET /api/discussion/posts?cursor=&limit= — feed "load more" pages.
export async function GET(req: Request) {
  const session = await auth();
  const sp = new URL(req.url).searchParams;
  const { items, hasMore, nextCursor } = await listPosts({
    cursor: sp.get('cursor'),
    limit: Number(sp.get('limit') ?? 10),
    viewerId: session?.user?.id ?? null,
  });
  const adm = Boolean(session?.user?.isAdmin);
  return NextResponse.json({
    items: items.map((p) => ({ ...p, author: toPublicAuthor(p.author, adm) })),
    hasMore,
    nextCursor,
  });
}

const mediaItemSchema = z.object({
  kind: z.enum(['image', 'video', 'video_link', 'file']),
  // Uploaded kinds identify the asset by its storage key (the URL is recomputed
  // server-side); video_link carries the external URL instead.
  key: z.string().min(1).max(512).optional(),
  url: z.string().min(1).max(2048).optional(),
  name: z.string().max(200).default(''),
  mimeType: z.string().max(100).default(''),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
});

const createSchema = z.object({
  bodyMd: z.string().max(8000).default(''),
  media: z.array(mediaItemSchema).max(9).default([]),
});

type MediaInput = z.infer<typeof mediaItemSchema>;

/**
 * Re-derive each attachment's URL from its storage key so a crafted request
 * can never make a post point at an arbitrary path. Returns null on any
 * invalid item (the caller 400s).
 */
function resolveMedia(items: MediaInput[]) {
  const out: {
    kind: MediaInput['kind'];
    key: string;
    url: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
    width: number | null;
    height: number | null;
    sortOrder: number;
  }[] = [];
  let images = 0;
  let videos = 0;
  let files = 0;

  for (const item of items) {
    let key = '';
    let url = '';
    if (item.kind === 'video_link') {
      const raw = (item.url ?? '').trim();
      let parsed: URL;
      try {
        parsed = new URL(raw);
      } catch {
        return null;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      url = parsed.toString();
      videos++;
    } else if (item.kind === 'image') {
      if (!item.key || !/^images\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/.test(item.key)) return null;
      key = item.key;
      url = imagePublicUrl(key);
      images++;
    } else {
      const prefix = item.kind === 'video' ? 'video/' : 'file/';
      if (!item.key || !item.key.startsWith(prefix)) return null;
      if (!/^(video|file)\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/.test(item.key)) return null;
      key = item.key;
      url = postMediaPublicUrl(key);
      if (item.kind === 'video') videos++;
      else files++;
    }
    out.push({
      kind: item.kind,
      key,
      url,
      name: item.name.trim().slice(0, 200),
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      width: item.width ?? null,
      height: item.height ?? null,
      sortOrder: out.length,
    });
  }

  // Feed-card layout limits: an image gallery, at most ONE video (uploaded or
  // linked), and a short attachment list.
  if (images > 9 || videos > 1 || files > 4) return null;
  return out;
}

// POST /api/discussion/posts — publish a feed post.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:post:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '发布过于频繁，请稍后再试' },
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

  const bodyMd = parsed.data.bodyMd.trim();
  const media = resolveMedia(parsed.data.media);
  if (!media) {
    return NextResponse.json(
      { error: 'invalid_input', reason: '附件无效或超出数量限制' },
      { status: 400 },
    );
  }
  if (!bodyMd && media.length === 0) {
    return NextResponse.json(
      { error: 'invalid_input', reason: '说点什么，或附上图片 / 视频 / 文件' },
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

  return NextResponse.json({
    ok: true,
    post: {
      ...created,
      author: toPublicAuthor(created.author, session.user.isAdmin),
      likedByMe: false,
    },
  });
}
