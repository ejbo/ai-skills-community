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
  MAX_DESIGNATED_VIEWERS,
  getZonePostDetail,
  setZonePostFlags,
  softDeleteZonePost,
  updateZonePost,
  type ZonePostInput,
} from '@/lib/zones/post-queries';
import {
  MAX_ATTACHMENT_ROWS_PER_POST,
  MAX_ZONE_COLUMNS,
  ZONE_LIMITS,
  ZONE_MEDIA_KEY_RE,
  ZONE_POST_TYPES,
  ZONE_POST_VISIBILITIES,
  normalizeHttpUrl,
  normalizeTags,
} from '@/lib/zones/shared';

export const dynamic = 'force-dynamic';

const REASONED_CODES: ReadonlySet<string> = new Set([
  'coauthor_not_member',
  'cover_invalid',
  'link_invalid',
  'title_required',
  'attachments_invalid',
  'attachments_too_many',
  'announcement_forbidden',
  'not_published',
  'too_many_pinned',
  'invalid_input',
  // 栏目 (ask #2) + 可见性 (ask #4)
  'column_name_required',
  'column_create_forbidden',
  'columns_full',
  'column_not_found',
  'column_exists',
  'designated_not_member',
  'designated_too_many',
]);

async function zoneErrorResponse(e: unknown): Promise<NextResponse | null> {
  if (e instanceof ZoneError) {
    // `{max}` = 置顶上限, `{limit}` = 栏目上限, `{rows}` = 附件行上限 — distinct
    // placeholders, so one values object serves every reasoned code.
    const reason = REASONED_CODES.has(e.code)
      ? await apiReason(`zone_${e.code}`, {
          max: ZONE_LIMITS.maxPinnedPosts,
          limit: MAX_ZONE_COLUMNS,
          rows: MAX_ATTACHMENT_ROWS_PER_POST,
        })
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
    // Unlimited by product decision — the cap is the hidden sanity bound only.
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENT_ROWS_PER_POST).optional(),
    status: z.enum(['draft', 'published']).optional(),
    // 栏目 (ask #2): an existing id, null for 未归栏, or a typed name that is
    // created on the fly (`columnName` wins over `columnId` — the lib decides).
    columnId: z.string().trim().max(64).nullable().optional(),
    columnName: z.string().trim().max(ZONE_LIMITS.columnNameMax * 2).nullable().optional(),
    // 可见性 (ask #4): NARROWS inside the zone, never widens it.
    visibility: z.enum(ZONE_POST_VISIBILITIES).optional(),
    designatedUserIds: z.array(z.string().trim().min(1).max(64)).max(MAX_DESIGNATED_VIEWERS).optional(),
    regenerateAccessCode: z.boolean().optional(),
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
// `type` is hidden from the composer; the only UI sender is the moderator's
// 设为公告 / 取消公告 (`{ type: 'announcement' | 'article' }`) — so every change
// of `type`, in either direction, needs canModerate (gated below). `linkUrl`
// is optional whatever the type (no `link_required`).
// `attachments` replaces the WHOLE ledger and is unioned with the body's
// `[embed:file:<key>]` tokens in the lib; a patch carrying only `bodyMd`
// leaves the rows alone.
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
  // `type` is hidden from every author-facing UI; the only sender is the
  // moderator's 设为公告 / 取消公告. So ANY change of the stored type — into
  // `announcement` AND out of it — is a moderator act: an author must not be
  // able to drop the zone notice a 版主 pinned on their post by PATCHing
  // `{ type: 'article' }` (the pre-2026-09 gate only checked the NEW value).
  const typeChanges = content.type !== undefined && content.type !== post.type;
  const touchesAnnouncement = typeChanges && (content.type === 'announcement' || post.type === 'announcement');
  if ((touchesAnnouncement || (publishes && nextType === 'announcement')) && !ctx.access.canModerate) {
    return NextResponse.json(
      { error: 'forbidden', reason: await apiReason('zone_announcement_forbidden') },
      { status: 403 },
    );
  }
  if (typeChanges && !ctx.access.canModerate) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
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
  // 栏目 / 可见性 are content fields: the same author-or-moderator gate above
  // already covers them, and the lib owns every rule (column creation policy,
  // designated members must be zone members, code rotation, grant cleanup).
  if (content.columnId !== undefined) patch.columnId = content.columnId;
  if (content.columnName !== undefined) patch.columnName = content.columnName;
  if (content.visibility !== undefined) patch.visibility = content.visibility;
  if (content.designatedUserIds !== undefined) {
    patch.designatedUserIds = [...new Set(content.designatedUserIds)];
  }
  if (content.regenerateAccessCode !== undefined) patch.regenerateAccessCode = content.regenerateAccessCode;

  try {
    if (editsContent) {
      await updateZonePost(post.id, patch, { canModerate: ctx.access.canModerate, actorId: uid });
    }
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
