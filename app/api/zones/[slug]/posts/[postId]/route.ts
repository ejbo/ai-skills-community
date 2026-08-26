import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { getLocale } from 'next-intl/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiReason } from '@/lib/api-errors';
import { logAdmin } from '@/lib/audit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import {
  getZonePostDetail,
  setZonePostFlags,
  softDeleteZonePost,
  updateZonePost,
  type ZonePostInput,
} from '@/lib/zones/post-queries';
import {
  MAX_ZONE_ATTACHMENTS,
  ZONE_LIMITS,
  ZONE_MEDIA_KEY_RE,
  ZONE_POST_TYPES,
  normalizeHttpUrl,
  normalizeTags,
} from '@/lib/zones/shared';

export const dynamic = 'force-dynamic';

const REASONED_CODES: ReadonlySet<string> = new Set([
  'coauthor_not_member',
  'cover_invalid',
  'link_required',
  'link_invalid',
  'title_required',
  'attachments_invalid',
  'not_published',
  'too_many_pinned',
  'invalid_input',
]);

async function zoneErrorResponse(e: unknown): Promise<NextResponse | null> {
  if (e instanceof ZoneError) {
    const reason = REASONED_CODES.has(e.code)
      ? await apiReason(`zone_${e.code}`, { max: ZONE_LIMITS.maxPinnedPosts })
      : undefined;
    return NextResponse.json({ error: e.code, ...(reason ? { reason } : {}) }, { status: e.status });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
    return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
  }
  return null;
}

const attachmentSchema = z.object({
  key: z.string().regex(ZONE_MEDIA_KEY_RE),
  name: z.string().max(200).default(''),
  mimeType: z.string().max(120).default(''),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  width: z.number().int().positive().nullish(),
  height: z.number().int().positive().nullish(),
  posterKey: z.string().regex(ZONE_MEDIA_KEY_RE).nullish(),
});

// A post cover is uploaded through /attachments/upload as kind `image`
// (stored `image/<id>.<ext>`); `cover/` is accepted for parity with zone covers.
const COVER_KEY_RE = /^(image|cover)\//;

const patchSchema = z
  .object({
    type: z.enum(ZONE_POST_TYPES).optional(),
    title: z.string().trim().min(ZONE_LIMITS.postTitleMin).max(ZONE_LIMITS.postTitleMax).optional(),
    summary: z.string().trim().max(ZONE_LIMITS.postSummaryMax).optional(),
    bodyMd: z.string().max(ZONE_LIMITS.postBodyMax).optional(),
    coverKey: z.string().regex(ZONE_MEDIA_KEY_RE).regex(COVER_KEY_RE).nullable().optional(),
    linkUrl: z.string().max(2048).nullable().optional(),
    tags: z.array(z.string().max(64)).max(64).optional(),
    coauthorIds: z.array(z.string().min(1).max(64)).max(ZONE_LIMITS.maxCoauthors).optional(),
    attachments: z.array(attachmentSchema).max(MAX_ZONE_ATTACHMENTS).optional(),
    status: z.enum(['draft', 'published']).optional(),
    pinned: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'empty_patch' });

const POST_ROW_SELECT = {
  id: true,
  zoneId: true,
  authorId: true,
  type: true,
  title: true,
  status: true,
  pinned: true,
  locked: true,
  deletedAt: true,
  coauthors: { select: { userId: true } },
} satisfies Prisma.ZonePostSelect;

// GET /api/zones/[slug]/posts/[postId] → { post: ZonePostDetailView }
export async function GET(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const locale = await getLocale();
  const post = await getZonePostDetail(params.postId, ctx.zone, ctx.access, ctx.viewer, { session, locale });
  if (!post) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ post });
}

// PATCH /api/zones/[slug]/posts/[postId]
//   content fields (author / co-author OR canModerate) and/or { pinned, locked } (canModerate)
//   → { ok: true }
export async function PATCH(req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? (await apiReason('invalid_request')) },
      { status: 400 },
    );
  }

  const post = await prisma.zonePost.findUnique({ where: { id: params.postId }, select: POST_ROW_SELECT });
  if (!post || post.zoneId !== ctx.zone.id || post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const uid = session.user.id;
  const isAuthor = post.authorId === uid || post.coauthors.some((c) => c.userId === uid);
  const { pinned, locked, ...content } = parsed.data;

  const editsContent = Object.values(content).some((x) => x !== undefined);
  const moderates = pinned !== undefined || locked !== undefined;
  // A draft → published transition IS a publish: re-apply the gates POST applies,
  // so an author who has since lost `post` (or left the zone) cannot ship the
  // draft anyway, and a post that is already an announcement cannot go live
  // without `moderate` just because its type was not re-sent.
  const publishes = content.status === 'published' && post.status !== 'published';
  const nextType = content.type ?? post.type;

  if (editsContent && !isAuthor && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (moderates && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (publishes && !ctx.access.canPost && !ctx.access.canModerate) {
    return NextResponse.json(
      { error: 'forbidden', reason: await apiReason('zone_post_forbidden') },
      { status: 403 },
    );
  }
  if ((content.type === 'announcement' || (publishes && nextType === 'announcement')) && !ctx.access.canModerate) {
    return NextResponse.json(
      { error: 'forbidden', reason: await apiReason('zone_announcement_forbidden') },
      { status: 403 },
    );
  }

  // Build the partial input with only the keys that were sent; normalize the
  // free-form ones here so the lib layer receives clean values.
  const patch: Partial<ZonePostInput> = {};
  if (content.type !== undefined) patch.type = content.type;
  if (content.title !== undefined) patch.title = content.title;
  if (content.summary !== undefined) patch.summary = content.summary;
  if (content.bodyMd !== undefined) patch.bodyMd = content.bodyMd;
  if (content.coverKey !== undefined) patch.coverKey = content.coverKey;
  if (content.linkUrl !== undefined) {
    if (content.linkUrl === null || content.linkUrl.trim() === '') {
      patch.linkUrl = null;
    } else {
      const normalized = normalizeHttpUrl(content.linkUrl);
      if (!normalized) {
        return NextResponse.json(
          { error: 'invalid_input', reason: await apiReason('invalid_request') },
          { status: 400 },
        );
      }
      patch.linkUrl = normalized;
    }
  }
  if (content.tags !== undefined) patch.tags = normalizeTags(content.tags);
  if (content.coauthorIds !== undefined) {
    patch.coauthorIds = [...new Set(content.coauthorIds)].filter((id) => id !== post.authorId);
  }
  if (content.attachments !== undefined) {
    patch.attachments = content.attachments.map((a) => ({
      key: a.key,
      name: a.name.trim().slice(0, 200),
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      width: a.width ?? null,
      height: a.height ?? null,
      posterKey: a.posterKey ?? null,
    }));
  }
  if (content.status !== undefined) patch.status = content.status;

  try {
    if (editsContent) await updateZonePost(post.id, patch);
    if (moderates) {
      await setZonePostFlags(post.id, {
        ...(pinned !== undefined ? { pinned } : {}),
        ...(locked !== undefined ? { locked } : {}),
      });
    }
  } catch (e) {
    const res = await zoneErrorResponse(e);
    if (res) return res;
    throw e;
  }

  // Site-admin bypass on a zone the actor does not belong to is audited.
  const siteAdminOutsider = ctx.access.siteAdmin && !ctx.access.isMember;
  if (siteAdminOutsider && (moderates || (editsContent && !isAuthor))) {
    await logAdmin({
      adminUserId: uid,
      action: moderates ? 'moderate_zone_post' : 'edit_zone_post',
      targetType: 'zone_post',
      targetId: post.id,
      details: {
        zoneSlug: ctx.zone.slug,
        title: post.title,
        ...(pinned !== undefined ? { pinned: { before: post.pinned, after: pinned } } : {}),
        ...(locked !== undefined ? { locked: { before: post.locked, after: locked } } : {}),
        ...(editsContent ? { fields: Object.keys(patch) } : {}),
      },
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/zones/[slug]/posts/[postId] (author OR canModerate) → soft delete → { ok: true }
export async function DELETE(_req: Request, { params }: { params: { slug: string; postId: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const post = await prisma.zonePost.findUnique({ where: { id: params.postId }, select: POST_ROW_SELECT });
  if (!post || post.zoneId !== ctx.zone.id || post.deletedAt) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const isAuthor = post.authorId === session.user.id;
  if (!isAuthor && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    await softDeleteZonePost(post.id);
  } catch (e) {
    const res = await zoneErrorResponse(e);
    if (res) return res;
    throw e;
  }

  if (!isAuthor && ctx.access.siteAdmin && !ctx.access.isMember) {
    await logAdmin({
      adminUserId: session.user.id,
      action: 'delete_zone_post',
      targetType: 'zone_post',
      targetId: post.id,
      details: { zoneSlug: ctx.zone.slug, title: post.title, authorId: post.authorId },
    });
  }

  return NextResponse.json({ ok: true });
}
