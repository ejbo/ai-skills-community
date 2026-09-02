import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { mediaArraySchema, mediaKeysAvailable, resolveMedia } from '@/lib/discussion-media';
import { discussionTagMap } from '@/lib/discussion-queries';
import {
  MAX_CUSTOM_TAGS,
  MAX_OFFICIAL_TAGS,
  sanitizeTopicTags,
  tagErrorReason,
} from '@/lib/discussion-tags';
import { notifyMentions } from '@/lib/mention-notify';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// 主题 = DiscussionTag slug（侧栏分类 + 成员自建）。存在性/配额校验要查库，
// 所以 zod 这里只管形状，语义交给 sanitizeTopicTags —— 两条路由共用同一处规则。
const categoriesSchema = z
  .array(z.string().trim().min(1).max(64))
  .min(1, '请至少选择一个主题')
  .max(MAX_OFFICIAL_TAGS + MAX_CUSTOM_TAGS);

const createSchema = z.object({
  title: z.string().trim().min(4, '标题至少 4 个字').max(120),
  bodyMd: z.string().max(20000).default(''),
  categories: categoriesSchema,
  media: mediaArraySchema,
});

// POST /api/discussion/topics — start a forum topic.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:topic:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: await apiReason('rate_limited_topic') },
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

  const media = resolveMedia(parsed.data.media);
  if (!media) {
    return NextResponse.json(
      { error: 'invalid_input', reason: await apiReason('media_invalid') },
      { status: 400 },
    );
  }
  if (!(await mediaKeysAvailable(media))) {
    return NextResponse.json(
      { error: 'invalid_input', reason: await apiReason('media_in_use') },
      { status: 400 },
    );
  }

  const tags = sanitizeTopicTags(parsed.data.categories, await discussionTagMap());
  if (!tags.ok) {
    return NextResponse.json(
      { error: 'invalid_input', reason: tagErrorReason(tags.error) },
      { status: 400 },
    );
  }

  const { categories, official } = tags.value;
  const created = await prisma.discussionTopic.create({
    data: {
      title: parsed.data.title,
      bodyMd: parsed.data.bodyMd,
      categories,
      // 主分类列 = 第一个侧栏分类（[category, lastActivityAt] 索引仍然有意义）。
      category: official[0],
      authorId: session.user.id,
      media: { create: media },
    },
    select: { id: true },
  });

  // @人 — 讨论区 topics are readable by anyone, so no visibility gate.
  void notifyMentions({
    bodyMd: parsed.data.bodyMd,
    actorId: session.user.id,
    actorName: session.user.displayName,
    site: { what: '帖子', title: parsed.data.title, link: `/discussion/topics/${created.id}` },
  });

  return NextResponse.json({ ok: true, topic: created });
}
