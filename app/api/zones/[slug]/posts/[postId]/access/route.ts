// 技术专区 — 指定成员可见 的授权面板 (ask #4). Privileged surface only: the
// author, a co-author, 版主 or site staff. Everyone else gets a flat 403 — the
// designated-viewer list and the 访问密码 are exactly what a non-privileged
// viewer must never see, so they are not shipped and then hidden.
//
// The single source of "who may open this post" stays ZonePostViewer: 指定成员
// are `via: 'designated'` rows (replaced wholesale) and code redemptions are
// `via: 'code'` rows, so this panel shows both with one query.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Session } from 'next-auth';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { decideZonePostAccess, zonePostAccessContext } from '@/lib/zones/post-access';
import {
  MAX_DESIGNATED_VIEWERS,
  ZONE_POST_ACCESS_SELECT,
  listZonePostGrants,
  revokeZonePostAccess,
  setZonePostAccess,
} from '@/lib/zones/post-queries';
import { ZoneError } from '@/lib/zones/queries';
import type { ZonePostVisibilityValue } from '@/lib/zones/shared';
import { MINUTE_MS, zoneErrorResponse, zoneFail, zoneReason } from '../../../../_zone-api';

export const dynamic = 'force-dynamic';

const ACCESS_WRITES_PER_MINUTE = 30;

const putSchema = z
  .object({
    designatedUserIds: z.array(z.string().trim().min(1).max(64)).max(MAX_DESIGNATED_VIEWERS).optional(),
    regenerateAccessCode: z.boolean().optional(),
    clearAccessCode: z.boolean().optional(),
    /** Kick someone out — including a viewer who came in through the code. */
    revokeUserIds: z.array(z.string().trim().min(1).max(64)).max(MAX_DESIGNATED_VIEWERS).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'empty_patch' });

const ACCESS_ROW_SELECT = { ...ZONE_POST_ACCESS_SELECT, zoneId: true, accessCode: true };

async function accessErrorResponse(e: unknown): Promise<NextResponse> {
  if (e instanceof ZoneError) {
    const reason = await zoneReason(e.code, { limit: MAX_DESIGNATED_VIEWERS, max: MAX_DESIGNATED_VIEWERS });
    return NextResponse.json({ error: e.code, ...(reason ? { reason } : {}) }, { status: e.status });
  }
  // Serializable clash / unique race → 409; anything else is a real bug and rethrows.
  return zoneErrorResponse(e);
}

/**
 * Loads the post and says whether the viewer is privileged on it — the SAME
 * decision the reader uses (`decideZonePostAccess`), never a re-derived one.
 */
async function loadPost(slug: string, postId: string, session: Session | null) {
  const ctx = await zoneContext(slug, session);
  if (!ctx) return { ctx: null, post: null, privileged: false } as const;
  const post = await prisma.zonePost.findFirst({
    where: { id: postId, zoneId: ctx.zone.id },
    select: ACCESS_ROW_SELECT,
  });
  if (!post || post.deletedAt) return { ctx, post: null, privileged: false } as const;
  const decision = decideZonePostAccess(
    {
      authorId: post.authorId,
      coauthorIds: post.coauthors.map((c) => c.userId),
      status: post.status,
      deletedAt: post.deletedAt,
      visibility: post.visibility,
    },
    zonePostAccessContext(ctx.access),
  );
  return { ctx, post, privileged: decision === 'privileged' } as const;
}

async function statePayload(
  postId: string,
  accessCode: string | null,
  visibility: ZonePostVisibilityValue,
  canSeeIdentity: boolean,
) {
  const grants = await listZonePostGrants(postId, canSeeIdentity);
  return {
    visibility,
    accessCode,
    designatedViewers: grants.filter((g) => g.via === 'designated').map((g) => g.user),
    grants,
  };
}

// GET /api/zones/[slug]/posts/[postId]/access
//   → { visibility, accessCode, designatedViewers, grants }
export async function GET(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { ctx, post, privileged } = await loadPost(params.slug, params.postId, session);
  if (!ctx || !post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!privileged) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  return NextResponse.json(
    await statePayload(post.id, post.accessCode ?? null, post.visibility, ctx.access.canSeeIdentity),
  );
}

// PUT /api/zones/[slug]/posts/[postId]/access
//   { designatedUserIds?, regenerateAccessCode?, clearAccessCode?, revokeUserIds? }
//   → the authoritative state (same shape as GET)
export async function PUT(req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:post-access:${session.user.id}`, ACCESS_WRITES_PER_MINUTE, MINUTE_MS);
  if (!gate.allowed) return zoneFail('rate_limited_access', 429, { resetAt: gate.resetAt });

  const { ctx, post, privileged } = await loadPost(params.slug, params.postId, session);
  if (!ctx || !post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!privileged) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return zoneFail('invalid_input', 400);
  const { designatedUserIds, regenerateAccessCode, clearAccessCode, revokeUserIds } = parsed.data;

  let accessCode = post.accessCode ?? null;
  try {
    if (designatedUserIds !== undefined || regenerateAccessCode || clearAccessCode) {
      const next = await setZonePostAccess(
        post.id,
        { designatedUserIds, regenerateAccessCode, clearAccessCode },
        session.user.id,
        ctx.access.canSeeIdentity,
      );
      accessCode = next.accessCode;
    }
    // Explicit revokes run LAST so they win over a designated list sent in the
    // same call; a code-redeemed row is the usual target.
    for (const userId of [...new Set(revokeUserIds ?? [])]) {
      await revokeZonePostAccess(post.id, userId);
    }
  } catch (e) {
    return accessErrorResponse(e);
  }

  return NextResponse.json(await statePayload(post.id, accessCode, post.visibility, ctx.access.canSeeIdentity));
}
