import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import {
  findOrCreateDiscussionTag,
  listOfficialDiscussionTags,
  searchCustomDiscussionTags,
} from '@/lib/discussion-queries';
import { TAG_NAME_MAX, TAG_NAME_MIN } from '@/lib/discussion-tags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

// GET /api/discussion/tags?q=&scope=custom|official
// 自建分类的候选列表：给了 q 就搜，没给就给最常用的几个。默认只返回自建的 ——
// 侧栏那 8 个由页面直接服务端渲染进选择器，不用再跑一趟网络。
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  if (sp.get('scope') === 'official') {
    return NextResponse.json({ tags: await listOfficialDiscussionTags() });
  }
  const q = (sp.get('q') ?? '').slice(0, 40);
  return NextResponse.json({ tags: await searchCustomDiscussionTags(q) });
}

const createSchema = z.object({ name: z.string().trim().min(TAG_NAME_MIN).max(TAG_NAME_MAX) });

// POST (login) — 成员自建分类。find-or-create：输入一个已存在的名字会选中那一个
// 而不是分叉出近似重复项。新建的一律不进侧栏（official=false）。
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`discussion:new-tag:${session.user.id}`, 20, HOUR_MS);
  if (!gate.allowed) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });

  const result = await findOrCreateDiscussionTag(parsed.data.name, session.user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, tag: result.tag, created: result.created });
}
