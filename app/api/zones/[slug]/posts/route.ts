import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { apiReason } from '@/lib/api-errors';
import { rateLimit } from '@/lib/rate-limit';
import { zoneContext } from '@/lib/zones/access';
import { ZoneError } from '@/lib/zones/queries';
import { createZonePost, listMyDrafts, listZonePosts, zonePostInputSchema } from '@/lib/zones/post-queries';
import { MAX_ZONE_COLUMNS, ZONE_LIMITS, isZonePostType, parseZonePostSort } from '@/lib/zones/shared';

export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;
const POSTS_PER_HOUR = 20;

/** ZoneError codes that carry a translated `reason` (keys `api_errors.zone_<code>`). */
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
    // `{max}` = 置顶上限, `{limit}` = 栏目上限 — distinct placeholders, so one
    // values object serves every reasoned code.
    const reason = REASONED_CODES.has(e.code)
      ? await apiReason(`zone_${e.code}`, { max: ZONE_LIMITS.maxPinnedPosts, limit: MAX_ZONE_COLUMNS })
      : undefined;
    return NextResponse.json({ error: e.code, ...(reason ? { reason } : {}) }, { status: e.status });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') {
    return NextResponse.json({ error: 'conflict', reason: await apiReason('zone_conflict') }, { status: 409 });
  }
  return null;
}

// GET /api/zones/[slug]/posts?type&tag&q&sort&cursor&limit&author&column&drafts=1
//   → { items, hasMore, nextCursor }  (drafts=1 → { items } of the viewer's own drafts)
export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const sp = new URL(req.url).searchParams;

  if (sp.get('drafts') === '1') {
    // Drafts are the viewer's own rows (author or co-author) — a member who
    // lost `post` still needs to see and clean them up, so gate on read only.
    if (!ctx.access.canRead) {
      return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
    }
    const items = await listMyDrafts(ctx.zone.id, ctx.viewer, ctx.access);
    return NextResponse.json({ items });
  }

  if (!ctx.access.canRead) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_no_access') }, { status: 403 });
  }

  const typeRaw = sp.get('type');
  const type = isZonePostType(typeRaw) ? typeRaw : undefined;
  const tag = (sp.get('tag') ?? '').trim().slice(0, 24) || undefined;
  const q = (sp.get('q') ?? '').trim().slice(0, 100) || undefined;
  const sort = parseZonePostSort(sp.get('sort'));
  const cursor = sp.get('cursor');
  const limitRaw = Number.parseInt(sp.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, limitRaw)) : undefined;
  const authorHandle = (sp.get('author') ?? '').trim().slice(0, 64) || undefined;
  // 栏目 filter — `?column=<slug>` (an id also resolves, for the picker).
  const column = (sp.get('column') ?? '').trim().slice(0, 64) || undefined;

  const result = await listZonePosts({
    zone: ctx.zone,
    access: ctx.access,
    viewer: ctx.viewer,
    type,
    tag,
    q,
    sort,
    cursor,
    limit,
    authorHandle,
    column,
  });
  return NextResponse.json(result);
}

// POST /api/zones/[slug]/posts  { ...ZonePostInput }  (access.canPost; announcement ⇒ canModerate)
//   → 201 { id }
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const gate = rateLimit(`zones:post:${session.user.id}`, POSTS_PER_HOUR, HOUR_MS);
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'rate_limited', reason: await apiReason('zone_rate_limited_post'), resetAt: gate.resetAt },
      { status: 429 },
    );
  }

  const ctx = await zoneContext(params.slug, session);
  if (!ctx) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!ctx.access.canPost) {
    return NextResponse.json({ error: 'forbidden', reason: await apiReason('zone_post_forbidden') }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = zonePostInputSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: 'invalid_input', reason: first?.message ?? (await apiReason('invalid_request')) },
      { status: 400 },
    );
  }
  const input = parsed.data;

  if (input.type === 'announcement' && !ctx.access.canModerate) {
    return NextResponse.json(
      { error: 'forbidden', reason: await apiReason('zone_announcement_forbidden') },
      { status: 403 },
    );
  }

  try {
    // `canModerate` is the policy half of 栏目 creation on the fly
    // (`allowCreate = canModerate || Zone.allowMemberColumns`) — the lib never
    // re-derives it. 可见性 / 指定成员 / 访问密码 ride the same validated input.
    const created = await createZonePost(ctx.zone, session.user.id, input, {
      canModerate: ctx.access.canModerate,
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (e) {
    const res = await zoneErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
