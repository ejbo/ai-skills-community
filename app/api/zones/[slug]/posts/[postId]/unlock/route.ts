// 技术专区 — 指定成员可见 (ask #4): redeem a post's 访问密码.
//
// Two rules make this safe:
//  1. The ZONE gate is checked FIRST. A grant NARROWS access inside a 版块 — it
//     can never open one the viewer may not read, so a code leaked outside the
//     zone is worthless (`redeemAccessCode` deliberately knows nothing about
//     zone policy).
//  2. Every failure — unknown post, wrong zone, not restricted, wrong code —
//     answers the SAME neutral `invalid_code`, and the real code is never echoed
//     back. Paired with a hard per-user AND per-user-per-post rate limit, the
//     6-char code cannot be brute-forced or probed for existence.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { redeemAccessCode } from '@/lib/zones/post-queries';
import { isValidAccessCode } from '@/lib/zones/shared';
import { HOUR_MS, MINUTE_MS, zoneFail } from '../../../../_zone-api';

export const dynamic = 'force-dynamic';

const TRIES_PER_MINUTE = 10;
const TRIES_PER_POST_PER_HOUR = 5;

const bodySchema = z.object({ code: z.string().trim().max(64) });

// POST /api/zones/[slug]/posts/[postId]/unlock { code } → { ok: true } | 400 { error: 'invalid_code' }
export async function POST(req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const uid = session.user.id;

  // Both buckets are consumed on every attempt, valid or not — the per-post one
  // is what caps a targeted guessing run, the per-user one caps a broad sweep.
  const burst = rateLimit(`zones:unlock:${uid}`, TRIES_PER_MINUTE, MINUTE_MS);
  if (!burst.allowed) return zoneFail('rate_limited_unlock', 429, { resetAt: burst.resetAt });
  const perPost = rateLimit(`zones:unlock:${uid}:${params.postId}`, TRIES_PER_POST_PER_HOUR, HOUR_MS);
  if (!perPost.allowed) return zoneFail('rate_limited_unlock', 429, { resetAt: perPost.resetAt });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isValidAccessCode(parsed.data.code)) return zoneFail('invalid_code', 400);

  // The post must live in THIS zone: the URL is the only thing tying the code to
  // a zone the viewer was gated on. A miss answers the neutral error rather than
  // 404, so the route never confirms which post ids exist.
  const post = await prisma.zonePost.findFirst({
    where: { id: params.postId, zoneId: ctx.zone.id, deletedAt: null },
    select: { id: true },
  });
  if (!post) return zoneFail('invalid_code', 400);

  const { ok } = await redeemAccessCode(post.id, uid, parsed.data.code);
  if (!ok) return zoneFail('invalid_code', 400);
  return NextResponse.json({ ok: true });
}
