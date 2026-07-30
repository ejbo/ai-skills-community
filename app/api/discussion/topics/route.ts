import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { mediaArraySchema, mediaKeysAvailable, resolveMedia } from '@/lib/discussion-media';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// AI-focused主题 set — `general` is a legacy value new topics can't pick.
const CATEGORY_ENUM = z.enum([
  'tech',
  'models',
  'agents',
  'skills',
  'research',
  'qa',
  'share',
  'showcase',
]);

const createSchema = z.object({
  title: z.string().trim().min(4, '标题至少 4 个字').max(120),
  bodyMd: z.string().max(20000).default(''),
  categories: z.array(CATEGORY_ENUM).min(1, '请至少选择一个主题').max(3, '最多选择 3 个主题'),
  media: mediaArraySchema,
});

// POST /api/discussion/topics — start a forum topic.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:topic:${session.user.id}`, 10, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: '发帖过于频繁，请稍后再试' },
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

  const media = resolveMedia(parsed.data.media);
  if (!media) {
    return NextResponse.json(
      { error: 'invalid_input', reason: '附件无效或超出数量限制' },
      { status: 400 },
    );
  }
  if (!(await mediaKeysAvailable(media))) {
    return NextResponse.json(
      { error: 'invalid_input', reason: '附件已被其他内容使用，请重新上传' },
      { status: 400 },
    );
  }

  const categories = [...new Set(parsed.data.categories)];
  const created = await prisma.discussionTopic.create({
    data: {
      title: parsed.data.title,
      bodyMd: parsed.data.bodyMd,
      categories,
      // Legacy single column stays in sync with categories[0] (old indexes).
      category: categories[0],
      authorId: session.user.id,
      media: { create: media },
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, topic: created });
}
