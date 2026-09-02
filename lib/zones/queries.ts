// 技术专区 query layer — zones / members / roles. ALL reads and writes for
// these three tables live here (lib/vote-queries.ts pattern); posts, comments
// and wiki have their own modules (post-queries.ts / wiki-queries.ts).
//
// Invariants:
// - every author goes through AUTHOR_IDENTITY_SELECT → toPublicAuthor(row,
//   viewer.canSeeIdentity) at this boundary; dates leave as ISO strings.
// - denormalized counters (Zone.memberCount / postCount) are RECOMPUTED by
//   `recountZone` inside the same transaction as the membership change, never
//   incremented blindly — races fall through to the authoritative recount.
// - policy failures throw `ZoneError(code, status)`; API routes map it to
//   `{ error: code }` with that status.

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { distinctDirectoryValues } from '@/lib/employee-directory';
import { allLabs, instituteNames, labsOf, mergeInstitutes } from '@/lib/org';
import { AUTHOR_IDENTITY_FIELDS, AUTHOR_IDENTITY_SELECT, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import { resolveZoneAccess, type ZoneAccessRow, type ZoneSiteViewer } from './access';
import { listZoneColumns } from './columns';
import { ZoneError } from './errors';
import {
  ZONE_MEMBER_ROLE_KEY,
  ZONE_MODERATOR_ROLE_KEY,
  ZONE_OWNER_ROLE_KEY,
  ZONE_ROLE_KEY_RE,
  ZONE_SYSTEM_ROLES,
  normalizeZonePermissions,
  type ZoneAccess,
} from './permissions';
import {
  ZONE_JOIN_POLICIES,
  ZONE_LIMITS,
  ZONE_VISIBILITIES,
  isValidZoneSlug,
  parseZoneLinks,
  type OrgDeptNode,
  type OrgLabNode,
  type ZoneLink,
  type ZoneSort,
  withConfiguredInstitutes,
} from './shared';
import { deleteZoneMediaFile, isValidZoneMediaKey, zoneMediaPublicUrl } from './storage';
import type { ZoneCardView, ZoneDetailView, ZoneMemberView, ZoneMembershipView, ZoneRoleView } from './types';

export const ZONE_HUB_PAGE_SIZE = 24;
export const MAX_FEATURED_ZONES = 6;

/** Owner label reported in payloads (the UI translates by `roleKey === 'owner'`). */
const OWNER_ROLE_NAME = '主版主';
const FALLBACK_MEMBER_ROLE_NAME = '成员';

const SYSTEM_ROLE_KEYS: ReadonlySet<string> = new Set([...ZONE_SYSTEM_ROLES.map((r) => r.key), ZONE_OWNER_ROLE_KEY]);

// ─── Errors ─────────────────────────────────────────────────────────────────

// The class itself lives in ./errors so post-queries.ts and columns.ts can
// throw it without an import cycle; this re-export keeps every existing
// `import { ZoneError } from '@/lib/zones/queries'` working.
export { ZoneError } from './errors';

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function isForeignKeyViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

type Db = Prisma.TransactionClient | typeof prisma;

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function clampInt(v: number | undefined, def: number, min: number, max: number): number {
  const n = Number(v ?? def);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : def;
}

// ─── Selects ────────────────────────────────────────────────────────────────

/** Hub card shape — exported so post-queries can build its zone stub the same way. */
export const ZONE_CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  tagline: true,
  coverUrl: true,
  iconUrl: true,
  lab: true,
  department: true,
  visibility: true,
  joinPolicy: true,
  featured: true,
  memberCount: true,
  postCount: true,
  lastActivityAt: true,
  createdAt: true,
  ownerId: true,
  owner: AUTHOR_IDENTITY_SELECT,
  // 版主 avatar stack: active members holding the `moderator` system role.
  members: {
    where: { status: 'active' as const, role: { is: { key: ZONE_MODERATOR_ROLE_KEY } } },
    orderBy: { joinedAt: 'asc' as const },
    take: 3,
    select: { userId: true, user: AUTHOR_IDENTITY_SELECT },
  },
  posts: {
    where: { status: 'published' as const, deletedAt: null },
    orderBy: [{ publishedAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { id: true, title: true, type: true, publishedAt: true },
  },
} satisfies Prisma.ZoneSelect;

export type ZoneCardRow = Prisma.ZoneGetPayload<{ select: typeof ZONE_CARD_SELECT }>;

const ZONE_DETAIL_SELECT = {
  ...ZONE_CARD_SELECT,
  descriptionMd: true,
  links: true,
  allowGuestComments: true,
  allowMemberColumns: true,
  deletedAt: true,
} satisfies Prisma.ZoneSelect;

type ZoneDetailRow = Prisma.ZoneGetPayload<{ select: typeof ZONE_DETAIL_SELECT }>;

const ZONE_ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  isSystem: true,
  permissions: true,
  sortOrder: true,
} satisfies Prisma.ZoneRoleSelect;

type ZoneRoleRow = Prisma.ZoneRoleGetPayload<{ select: typeof ZONE_ROLE_SELECT }>;

const MEMBER_SELECT = {
  id: true,
  userId: true,
  status: true,
  title: true,
  message: true,
  joinedAt: true,
  createdAt: true,
  roleId: true,
  role: { select: { key: true, name: true } },
  user: AUTHOR_IDENTITY_SELECT,
} satisfies Prisma.ZoneMemberSelect;

type MemberRow = Prisma.ZoneMemberGetPayload<{ select: typeof MEMBER_SELECT }>;

// ─── View mappers ───────────────────────────────────────────────────────────

export interface ZoneCardExtras {
  membership: ZoneMembershipView;
  canSeeIdentity: boolean;
}

/** Exported for reuse by post-queries (zone stub) if convenient. */
export function toZoneCardView(row: ZoneCardRow, extras: ZoneCardExtras): ZoneCardView {
  const owner = toPublicAuthor(row.owner, extras.canSeeIdentity);
  const moderators = row.members
    .filter((m) => m.userId !== row.ownerId)
    .map((m) => toPublicAuthor(m.user, extras.canSeeIdentity));
  const latest = row.posts[0];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    coverUrl: row.coverUrl,
    iconUrl: row.iconUrl,
    lab: row.lab,
    department: row.department,
    visibility: row.visibility,
    joinPolicy: row.joinPolicy,
    featured: row.featured,
    memberCount: row.memberCount,
    postCount: row.postCount,
    lastActivityAt: iso(row.lastActivityAt),
    createdAt: iso(row.createdAt),
    owner,
    moderators: [owner, ...moderators].slice(0, 4),
    latestPost:
      latest && latest.publishedAt
        ? { id: latest.id, title: latest.title, type: latest.type, publishedAt: iso(latest.publishedAt) }
        : null,
    membership: extras.membership,
  };
}

function toRoleView(row: ZoneRoleRow, memberCount: number): ZoneRoleView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    permissions: normalizeZonePermissions(row.permissions),
    sortOrder: row.sortOrder,
    memberCount,
  };
}

interface MemberViewCtx {
  ownerId: string;
  memberRoleName: string;
  canSeeIdentity: boolean;
  includeMessage: boolean;
  postCounts: ReadonlyMap<string, number>;
}

function toMemberView(row: MemberRow, ctx: MemberViewCtx): ZoneMemberView {
  const isOwner = row.userId === ctx.ownerId;
  return {
    id: row.id,
    userId: row.userId,
    user: toPublicAuthor(row.user, ctx.canSeeIdentity),
    status: row.status,
    title: row.title,
    roleKey: isOwner ? ZONE_OWNER_ROLE_KEY : (row.role?.key ?? ZONE_MEMBER_ROLE_KEY),
    roleName: isOwner ? OWNER_ROLE_NAME : (row.role?.name ?? ctx.memberRoleName),
    isOwner,
    joinedAt: isoOrNull(row.joinedAt),
    createdAt: iso(row.createdAt),
    message: ctx.includeMessage ? row.message : '',
    postCount: ctx.postCounts.get(row.userId) ?? 0,
  };
}

function membershipFromAccess(access: ZoneAccess): ZoneMembershipView {
  if (access.isOwner) return 'owner';
  if (access.membershipStatus === 'active') return 'active';
  if (access.membershipStatus === 'pending') return 'pending';
  return null;
}

/** One IN-query: the viewer's relationship to each zone in `rows`. */
async function membershipMap(viewer: ZoneSiteViewer, rows: { id: string; ownerId: string }[]): Promise<Map<string, ZoneMembershipView>> {
  const out = new Map<string, ZoneMembershipView>();
  if (!viewer.id || rows.length === 0) return out;
  const statuses = await prisma.zoneMember.findMany({
    where: { userId: viewer.id, zoneId: { in: rows.map((r) => r.id) } },
    select: { zoneId: true, status: true },
  });
  const byZone = new Map(statuses.map((s) => [s.zoneId, s.status]));
  for (const r of rows) {
    if (r.ownerId === viewer.id) out.set(r.id, 'owner');
    else {
      const s = byZone.get(r.id);
      out.set(r.id, s === 'active' ? 'active' : s === 'pending' ? 'pending' : null);
    }
  }
  return out;
}

async function cardsFor(rows: ZoneCardRow[], viewer: ZoneSiteViewer): Promise<ZoneCardView[]> {
  const membership = await membershipMap(viewer, rows);
  return rows.map((r) =>
    toZoneCardView(r, { membership: membership.get(r.id) ?? null, canSeeIdentity: viewer.canSeeIdentity }),
  );
}

async function memberRoleNameFor(zoneId: string, db: Db = prisma): Promise<string> {
  const role = await db.zoneRole.findUnique({
    where: { zoneId_key: { zoneId, key: ZONE_MEMBER_ROLE_KEY } },
    select: { name: true },
  });
  return role?.name ?? FALLBACK_MEMBER_ROLE_NAME;
}

/** Published-post counts per author inside one zone (one groupBy). */
async function postCountsFor(zoneId: string, userIds: string[]): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const grouped = await prisma.zonePost.groupBy({
    by: ['authorId'],
    where: { zoneId, status: 'published', deletedAt: null, authorId: { in: userIds } },
    _count: { _all: true },
  });
  return new Map(grouped.map((g) => [g.authorId, g._count._all]));
}

async function requireZone(zoneId: string, db: Db = prisma) {
  const zone = await db.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, slug: true, name: true, ownerId: true, joinPolicy: true, createdAt: true, deletedAt: true },
  });
  if (!zone) throw new ZoneError('not_found', 404);
  return zone;
}

/**
 * Zones whose CONTENT the viewer may read (mirrors buildZoneAccess#canRead in
 * SQL). Defined here — not in post-queries — so queries.ts stays free of an
 * import back from the post layer; post-queries re-exports it for embeds.ts.
 */
export function readableZoneWhere(viewer: ZoneSiteViewer): Prisma.ZoneWhereInput {
  if (viewer.siteAdmin) return { deletedAt: null };
  // /zones is login-walled; an anonymous viewer reads nothing (buildZoneAccess agrees).
  if (!viewer.id) return { id: { in: [] } };
  return {
    deletedAt: null,
    OR: [
      { visibility: 'public' },
      { ownerId: viewer.id },
      { members: { some: { userId: viewer.id, status: 'active' } } },
    ],
  };
}

// ─── Hub / lists ────────────────────────────────────────────────────────────

export interface ListZonesFilters {
  q?: string;
  lab?: string;
  department?: string;
  sort?: ZoneSort;
  page?: number;
  pageSize?: number;
  /** Viewer id only — never client input. Restricts to zones the user owns or is an active member of. */
  mineFor?: string | null;
  viewer: ZoneSiteViewer;
}

function zoneOrderBy(sort: ZoneSort | undefined): Prisma.ZoneOrderByWithRelationInput[] {
  switch (sort) {
    case 'new':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
    case 'members':
      return [{ memberCount: 'desc' }, { lastActivityAt: 'desc' }, { id: 'desc' }];
    default:
      return [{ lastActivityAt: 'desc' }, { id: 'desc' }];
  }
}

export async function listZones(f: ListZonesFilters): Promise<{
  items: ZoneCardView[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}> {
  const pageSize = clampInt(f.pageSize, ZONE_HUB_PAGE_SIZE, 1, 60);
  const requested = clampInt(f.page, 1, 1, 100_000);
  const q = (f.q ?? '').trim().slice(0, 64);
  const lab = (f.lab ?? '').trim();
  const department = (f.department ?? '').trim();
  const contains = { contains: q, mode: 'insensitive' as const };

  // Compose AND of OR-groups — never assign `where.OR` twice.
  const and: Prisma.ZoneWhereInput[] = [];
  if (q) and.push({ OR: [{ name: contains }, { tagline: contains }, { slug: contains }] });
  if (lab) and.push({ lab });
  if (department) and.push({ department });
  if (f.mineFor) {
    and.push({ OR: [{ ownerId: f.mineFor }, { members: { some: { userId: f.mineFor, status: 'active' } } }] });
  }
  const where: Prisma.ZoneWhereInput = { deletedAt: null, ...(and.length ? { AND: and } : {}) };

  const total = await prisma.zone.count({ where });
  const page = Math.min(requested, Math.max(1, Math.ceil(total / pageSize)));
  const rows = await prisma.zone.findMany({
    where,
    orderBy: zoneOrderBy(f.sort),
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: ZONE_CARD_SELECT,
  });
  const items = await cardsFor(rows, f.viewer);
  return { items, total, page, pageSize, hasMore: page * pageSize < total };
}

export async function featuredZones(viewer: ZoneSiteViewer, take = MAX_FEATURED_ZONES): Promise<ZoneCardView[]> {
  const rows = await prisma.zone.findMany({
    where: { deletedAt: null, featured: true },
    orderBy: [{ featuredAt: 'desc' }, { lastActivityAt: 'desc' }],
    take: clampInt(take, MAX_FEATURED_ZONES, 1, 24),
    select: ZONE_CARD_SELECT,
  });
  return cardsFor(rows, viewer);
}

/** Zones the viewer owns or is an active member of, most recently active first. */
export async function listMyZones(viewer: ZoneSiteViewer): Promise<ZoneCardView[]> {
  if (!viewer.id) return [];
  const rows = await prisma.zone.findMany({
    where: {
      deletedAt: null,
      OR: [{ ownerId: viewer.id }, { members: { some: { userId: viewer.id, status: 'active' } } }],
    },
    orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: ZONE_CARD_SELECT,
  });
  return cardsFor(rows, viewer);
}

export async function getZoneDetail(slug: string, viewer: ZoneSiteViewer): Promise<ZoneDetailView | null> {
  const s = slug.trim().toLowerCase();
  if (!s) return null;
  const row: ZoneDetailRow | null = await prisma.zone.findUnique({ where: { slug: s }, select: ZONE_DETAIL_SELECT });
  if (!row) return null;
  if (row.deletedAt && !viewer.siteAdmin) return null;

  const accessRow: ZoneAccessRow = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ownerId: row.ownerId,
    visibility: row.visibility,
    joinPolicy: row.joinPolicy,
    allowGuestComments: row.allowGuestComments,
    deletedAt: row.deletedAt,
  };
  const access = await resolveZoneAccess(accessRow, viewer);
  const [roles, columns, wikiCount, pendingCount] = await Promise.all([
    listZoneRoles(row.id),
    listZoneColumns(row.id),
    prisma.zoneWikiPage.count({ where: { zoneId: row.id, deletedAt: null } }),
    access.canManageMembers ? prisma.zoneMember.count({ where: { zoneId: row.id, status: 'pending' } }) : Promise.resolve(0),
  ]);

  const card = toZoneCardView(row, { membership: membershipFromAccess(access), canSeeIdentity: viewer.canSeeIdentity });
  return {
    ...card,
    descriptionMd: row.descriptionMd,
    links: parseZoneLinks(row.links),
    allowGuestComments: row.allowGuestComments,
    wikiCount,
    pendingCount,
    roles,
    columns,
    allowMemberColumns: row.allowMemberColumns,
    access,
  };
}

// ─── 组织架构 (研究所 → 实验室) ────────────────────────────────────────────────
//
// The vocabulary here is the one the owner uses: a 研究所 is the TOP level and
// is COMPOSED OF 实验室. The columns are named the other way round for
// historical reasons and are NOT being renamed (they are already in URLs,
// bookmarks and notification links):
//
//   Zone.lab        = 研究所  (top level, `?lab=`,        OrgLabNode.lab)
//   Zone.department = 实验室  (under it,  `?department=`, OrgDeptNode.department)
//
// `lib/org.ts` is the configured tree; live rows are the other half. Both
// helpers below MERGE the two so an empty 研究所 is still visible (the org chart
// exists before the 版块 do) and a value nobody configured still works — it just
// sorts after the configured ones. Neither is a whitelist: nothing here can
// refuse a save.

interface OrgPair {
  /** Zone.lab — the 研究所. */
  lab: string;
  /** Zone.department — the 实验室. */
  department: string;
}

const collateOrg = (a: string, b: string) => a.localeCompare(b, 'zh-CN');

/** Configured names first (in config order), then everything else, zh-CN sorted. */
function configuredFirst(configured: readonly string[], extra: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of configured) {
    const s = v.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  const rest = [...new Set(extra.map((v) => v.trim()).filter((v) => v && !seen.has(v)))].sort(collateOrg);
  return [...out, ...rest];
}

/**
 * The org tree from live 版块 rows, with the configured chart merged in.
 *
 * Building and merging are deliberately SEPARATE: this counts what the rows
 * actually carry, and `withConfiguredInstitutes` (lib/zones/shared.ts) applies
 * the org chart — the same function the hub's boards rail uses on an in-memory
 * list, so a 研究所 can never appear in one rail and not the other.
 */
export function buildZoneOrgTree(rows: readonly (OrgPair & { count: number })[]): OrgLabNode[] {
  const live = new Map<string, { zoneCount: number; departments: Map<string, number> }>();
  for (const r of rows) {
    const lab = (r.lab ?? '').trim();
    if (!lab) continue; // a 版块 with no 研究所 belongs to no branch of the tree
    const entry = live.get(lab) ?? { zoneCount: 0, departments: new Map<string, number>() };
    entry.zoneCount += r.count;
    const department = (r.department ?? '').trim();
    if (department) entry.departments.set(department, (entry.departments.get(department) ?? 0) + r.count);
    live.set(lab, entry);
  }

  const raw: OrgLabNode[] = [...live.entries()]
    .map(([lab, entry]) => ({
      lab,
      zoneCount: entry.zoneCount,
      departments: [...entry.departments.entries()].map(([department, zoneCount]) => ({ department, zoneCount })),
    }))
    // Busiest first, so an UNCONFIGURED 研究所 (appended by the merge) lands in
    // a sensible order rather than whatever the groupBy happened to return.
    .sort((a, b) => b.zoneCount - a.zoneCount || collateOrg(a.lab, b.lab));

  return withConfiguredInstitutes(raw);
}

/**
 * 研究所 → 实验室 tree over the zones this viewer may read (the hub filter rail).
 * One groupBy: a zone carries exactly one (研究所, 实验室) pair, so an institute's
 * count is the sum of its labs' counts plus the rows that name no 实验室.
 */
export async function zoneOrgTree(viewer: ZoneSiteViewer): Promise<OrgLabNode[]> {
  const rows = await prisma.zone.groupBy({
    by: ['lab', 'department'],
    where: readableZoneWhere(viewer),
    _count: { _all: true },
  });
  return buildZoneOrgTree(rows.map((r) => ({ lab: r.lab ?? '', department: r.department ?? '', count: r._count._all })));
}

/**
 * Option lists for the 组织归属 fields of the create wizard and 版块设置 — the
 * configured tree first, widened by whatever live rows and the employee roster
 * actually carry so no existing value is ever dropped from the picker.
 */
export interface ZoneOrgOptions {
  /** 研究所 options (stored in `Zone.lab`), configured order first. */
  institutes: string[];
  /** 研究所 → its 实验室 (stored in `Zone.department`), configured order first. */
  labsByInstitute: Record<string, string[]>;
  /** Every 实验室 known anywhere — the datalist behind the 「其他」 escape hatch. */
  labs: string[];
}

/** Pure half of `zoneFacets` (see tests/zones-org-tree.test.ts). */
export function buildZoneOrgOptions(
  pairs: readonly OrgPair[],
  rosterInstitutes: readonly string[],
  rosterLabs: readonly string[],
): ZoneOrgOptions {
  const liveLabsOf = new Map<string, Set<string>>();
  const liveInstitutes: string[] = [];
  const liveLabs: string[] = [];
  for (const p of pairs) {
    const institute = (p.lab ?? '').trim();
    const lab = (p.department ?? '').trim();
    if (institute) {
      liveInstitutes.push(institute);
      if (!liveLabsOf.has(institute)) liveLabsOf.set(institute, new Set());
    }
    if (lab) {
      liveLabs.push(lab);
      if (institute) liveLabsOf.get(institute)!.add(lab);
    }
  }

  const institutes = configuredFirst(instituteNames(), [...liveInstitutes, ...rosterInstitutes]);
  const labsByInstitute: Record<string, string[]> = {};
  for (const institute of institutes) {
    labsByInstitute[institute] = configuredFirst(labsOf(institute), [...(liveLabsOf.get(institute) ?? [])]);
  }
  return { institutes, labsByInstitute, labs: configuredFirst(allLabs(), [...liveLabs, ...rosterLabs]) };
}

/** 研究所 / 实验室 pickers: the configured tree ∪ live 版块 ∪ the employee roster. */
export async function zoneFacets(): Promise<ZoneOrgOptions> {
  const [pairs, rosterInstitutes, rosterLabs] = await Promise.all([
    prisma.zone.groupBy({ by: ['lab', 'department'], where: { deletedAt: null } }),
    // The roster's own columns follow the same mapping: `lab` is the 研究所.
    distinctDirectoryValues('lab').catch(() => [] as string[]),
    distinctDirectoryValues('department').catch(() => [] as string[]),
  ]);
  return buildZoneOrgOptions(
    pairs.map((p) => ({ lab: p.lab ?? '', department: p.department ?? '' })),
    rosterInstitutes,
    rosterLabs,
  );
}

// ─── Zone CRUD ──────────────────────────────────────────────────────────────

export interface ZoneInput {
  name: string;
  slug: string;
  tagline: string;
  descriptionMd: string;
  lab: string;
  department: string;
  visibility: 'public' | 'members';
  joinPolicy: 'open' | 'approval' | 'invite';
  allowGuestComments: boolean;
  /** Members may create their own 栏目 from the composer (版主 always can). */
  allowMemberColumns: boolean;
  links: ZoneLink[];
}

/** zod: full create payload (defaults applied); use `zoneInputSchema.partial()` for PATCH bodies. */
export const zoneInputSchema = z.object({
  name: z.string().trim().min(ZONE_LIMITS.nameMin).max(ZONE_LIMITS.nameMax),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine(isValidZoneSlug, { message: 'invalid_slug' }),
  tagline: z.string().trim().max(ZONE_LIMITS.taglineMax).default(''),
  descriptionMd: z.string().max(ZONE_LIMITS.descriptionMax).default(''),
  lab: z.string().trim().max(ZONE_LIMITS.labMax).default(''),
  department: z.string().trim().max(ZONE_LIMITS.departmentMax).default(''),
  visibility: z.enum(ZONE_VISIBILITIES).default('public'),
  joinPolicy: z.enum(ZONE_JOIN_POLICIES).default('approval'),
  allowGuestComments: z.boolean().default(true),
  allowMemberColumns: z.boolean().default(true),
  links: z.unknown().transform((v) => parseZoneLinks(v)).default([]),
});

export const zonePatchSchema = zoneInputSchema.partial();

/** Compile-time proof the schema output IS the contract shape. */
type ZoneInputParsed = z.infer<typeof zoneInputSchema>;
const _assertZoneInput: ZoneInputParsed extends ZoneInput ? (ZoneInput extends ZoneInputParsed ? true : never) : never = true;
void _assertZoneInput;

function linksJson(links: ZoneLink[]): Prisma.InputJsonValue {
  return parseZoneLinks(links) as unknown as Prisma.InputJsonValue;
}

/**
 * One transaction: the zone row, its three system roles (ZONE_SYSTEM_ROLES)
 * and the owner's own ZoneMember row (active, roleId null = implicit `*`).
 */
export async function createZone(input: ZoneInput, ownerId: string): Promise<{ id: string; slug: string }> {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  if (!isValidZoneSlug(slug)) throw new ZoneError('invalid_slug');
  if (name.length < ZONE_LIMITS.nameMin || name.length > ZONE_LIMITS.nameMax) throw new ZoneError('invalid_input');
  const now = new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const zone = await tx.zone.create({
        data: {
          slug,
          name,
          tagline: input.tagline.trim().slice(0, ZONE_LIMITS.taglineMax),
          descriptionMd: input.descriptionMd.slice(0, ZONE_LIMITS.descriptionMax),
          lab: input.lab.trim().slice(0, ZONE_LIMITS.labMax),
          department: input.department.trim().slice(0, ZONE_LIMITS.departmentMax),
          visibility: input.visibility,
          joinPolicy: input.joinPolicy,
          allowGuestComments: input.allowGuestComments,
          allowMemberColumns: input.allowMemberColumns,
          links: linksJson(input.links),
          ownerId,
          memberCount: 1,
          postCount: 0,
          lastActivityAt: now,
        },
        select: { id: true, slug: true },
      });
      await tx.zoneRole.createMany({
        data: ZONE_SYSTEM_ROLES.map((r) => ({
          zoneId: zone.id,
          key: r.key,
          name: r.name,
          description: r.description,
          isSystem: true,
          permissions: [...r.permissions],
          sortOrder: r.sortOrder,
        })),
      });
      await tx.zoneMember.create({
        data: { zoneId: zone.id, userId: ownerId, status: 'active', joinedAt: now, roleId: null },
      });
      return zone;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('slug_taken', 409);
    if (isForeignKeyViolation(e)) throw new ZoneError('user_not_found', 404);
    throw e;
  }
}

/** Partial update; cover/icon keys set the public url and delete the replaced file. */
export async function updateZone(
  zoneId: string,
  patch: Partial<ZoneInput> & { coverKey?: string | null; iconKey?: string | null },
): Promise<void> {
  const current = await prisma.zone.findUnique({
    where: { id: zoneId },
    select: { id: true, slug: true, coverKey: true, iconKey: true },
  });
  if (!current) throw new ZoneError('not_found', 404);
  const currentSlug = current.slug;

  const data: Prisma.ZoneUpdateInput = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (name.length < ZONE_LIMITS.nameMin || name.length > ZONE_LIMITS.nameMax) throw new ZoneError('invalid_input');
    data.name = name;
  }
  // The slug is IMMUTABLE after creation: every stored notification link, bookmark
  // and shared URL embeds it, so a rename silently breaks all of them. The PATCH
  // route already strips it; this throw is the lib-level backstop so a future
  // caller cannot reintroduce a rename primitive.
  if (patch.slug !== undefined && patch.slug.trim().toLowerCase() !== currentSlug) {
    throw new ZoneError('slug_immutable');
  }
  if (patch.tagline !== undefined) data.tagline = patch.tagline.trim().slice(0, ZONE_LIMITS.taglineMax);
  if (patch.descriptionMd !== undefined) data.descriptionMd = patch.descriptionMd.slice(0, ZONE_LIMITS.descriptionMax);
  if (patch.lab !== undefined) data.lab = patch.lab.trim().slice(0, ZONE_LIMITS.labMax);
  if (patch.department !== undefined) data.department = patch.department.trim().slice(0, ZONE_LIMITS.departmentMax);
  if (patch.visibility !== undefined) data.visibility = patch.visibility;
  if (patch.joinPolicy !== undefined) data.joinPolicy = patch.joinPolicy;
  if (patch.allowGuestComments !== undefined) data.allowGuestComments = patch.allowGuestComments;
  if (patch.allowMemberColumns !== undefined) data.allowMemberColumns = patch.allowMemberColumns;
  if (patch.links !== undefined) data.links = linksJson(patch.links);

  const staleKeys: string[] = [];
  if (patch.coverKey !== undefined) {
    if (patch.coverKey === null) {
      data.coverKey = null;
      data.coverUrl = null;
    } else {
      if (!isValidZoneMediaKey(patch.coverKey, 'cover')) throw new ZoneError('invalid_media_key');
      data.coverKey = patch.coverKey;
      data.coverUrl = zoneMediaPublicUrl(patch.coverKey);
    }
    if (current.coverKey && current.coverKey !== patch.coverKey) staleKeys.push(current.coverKey);
  }
  if (patch.iconKey !== undefined) {
    if (patch.iconKey === null) {
      data.iconKey = null;
      data.iconUrl = null;
    } else {
      if (!isValidZoneMediaKey(patch.iconKey, 'icon')) throw new ZoneError('invalid_media_key');
      data.iconKey = patch.iconKey;
      data.iconUrl = zoneMediaPublicUrl(patch.iconKey);
    }
    if (current.iconKey && current.iconKey !== patch.iconKey) staleKeys.push(current.iconKey);
  }

  if (Object.keys(data).length === 0) return;
  try {
    await prisma.zone.update({ where: { id: zoneId }, data });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('slug_taken', 409);
    throw e;
  }
  // Only after the row points elsewhere — a failed update must not orphan the live file.
  await Promise.all(staleKeys.map((k) => deleteZoneMediaFile(k)));
}

/**
 * 转让主版主: the new owner must already be an active member; the old owner
 * stays in the zone as 版主 (moderator system role). Counters recomputed.
 */
export async function transferZoneOwnership(zoneId: string, newOwnerId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      const zone = await requireZone(zoneId, tx);
      if (zone.ownerId === newOwnerId) return;
      const target = await tx.zoneMember.findUnique({
        where: { zoneId_userId: { zoneId, userId: newOwnerId } },
        select: { status: true, joinedAt: true },
      });
      if (!target || target.status !== 'active') throw new ZoneError('not_member');
      const moderator = await tx.zoneRole.findUnique({
        where: { zoneId_key: { zoneId, key: ZONE_MODERATOR_ROLE_KEY } },
        select: { id: true },
      });
      const now = new Date();
      await tx.zone.update({ where: { id: zoneId }, data: { ownerId: newOwnerId } });
      // The owner is implicit `*`: their row carries no role.
      await tx.zoneMember.update({
        where: { zoneId_userId: { zoneId, userId: newOwnerId } },
        data: { roleId: null, status: 'active', joinedAt: target.joinedAt ?? now, message: '' },
      });
      const previous = await tx.zoneMember.findUnique({
        where: { zoneId_userId: { zoneId, userId: zone.ownerId } },
        select: { joinedAt: true },
      });
      if (previous) {
        await tx.zoneMember.update({
          where: { zoneId_userId: { zoneId, userId: zone.ownerId } },
          data: { roleId: moderator?.id ?? null, status: 'active', joinedAt: previous.joinedAt ?? now, message: '' },
        });
      } else {
        await tx.zoneMember.create({
          data: { zoneId, userId: zone.ownerId, roleId: moderator?.id ?? null, status: 'active', joinedAt: now },
        });
      }
      await recountZone(zoneId, tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function softDeleteZone(zoneId: string): Promise<void> {
  const r = await prisma.zone.updateMany({ where: { id: zoneId, deletedAt: null }, data: { deletedAt: new Date() } });
  if (r.count === 0) {
    const exists = await prisma.zone.count({ where: { id: zoneId } });
    if (exists === 0) throw new ZoneError('not_found', 404);
  }
}

export async function restoreZone(zoneId: string): Promise<void> {
  const r = await prisma.zone.updateMany({ where: { id: zoneId, deletedAt: { not: null } }, data: { deletedAt: null } });
  if (r.count === 0) {
    const exists = await prisma.zone.count({ where: { id: zoneId } });
    if (exists === 0) throw new ZoneError('not_found', 404);
  }
}

/**
 * Recompute both denormalized counters from rows. memberCount counts active
 * members INCLUDING the owner (+1 even when the owner's own row is missing, so
 * a repaired zone never reads 0); postCount = published & not deleted.
 */
export async function recountZone(zoneId: string, tx?: Prisma.TransactionClient): Promise<void> {
  const db: Db = tx ?? prisma;
  const zone = await db.zone.findUnique({ where: { id: zoneId }, select: { ownerId: true } });
  if (!zone) return;
  const others = await db.zoneMember.count({
    where: { zoneId, status: 'active', userId: { not: zone.ownerId } },
  });
  const postCount = await db.zonePost.count({ where: { zoneId, status: 'published', deletedAt: null } });
  await db.zone.update({ where: { id: zoneId }, data: { memberCount: others + 1, postCount } });
}

// ─── Activity pulse ─────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 本周动态 for the zone home rail: two count()s over the last 7 days. Kept OUT
 * of getZoneDetail on purpose — that payload rides every zone route (wiki,
 * members, settings) and none of them shows the pulse; the zone home RSC calls
 * this once and passes the figures down.
 */
export async function zoneActivityPulse(zoneId: string): Promise<{ postsThisWeek: number; newMembersThisWeek: number }> {
  const since = new Date(Date.now() - WEEK_MS);
  const [postsThisWeek, newMembersThisWeek] = await Promise.all([
    prisma.zonePost.count({ where: { zoneId, status: 'published', deletedAt: null, publishedAt: { gte: since } } }),
    prisma.zoneMember.count({ where: { zoneId, status: 'active', joinedAt: { gte: since } } }),
  ]);
  return { postsThisWeek, newMembersThisWeek };
}

// ─── Members ────────────────────────────────────────────────────────────────

export interface ListMembersOptions {
  status?: 'active' | 'pending';
  q?: string;
  /** ZoneRole key, `member` (implicit role) or `owner`. */
  roleKey?: string;
  skip?: number;
  take?: number;
  /** Ship the join-request note (members-managers only). */
  includeMessage: boolean;
  canSeeIdentity: boolean;
}

function memberSearchWhere(q: string): Prisma.ZoneMemberWhereInput {
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { title: contains },
      { user: { OR: [{ displayName: contains }, { handle: contains }, { huaweiW3Name: contains }] } },
    ],
  };
}

function roleFilter(roleKey: string, ownerId: string): Prisma.ZoneMemberWhereInput {
  if (roleKey === ZONE_OWNER_ROLE_KEY) return { userId: ownerId };
  if (roleKey === ZONE_MEMBER_ROLE_KEY) {
    return { userId: { not: ownerId }, OR: [{ roleId: null }, { role: { is: { key: ZONE_MEMBER_ROLE_KEY } } }] };
  }
  return { role: { is: { key: roleKey } } };
}

/** Owner first (page 1), then role sortOrder, then joinedAt; postCount via one groupBy. */
export async function listZoneMembers(
  zoneId: string,
  opts: ListMembersOptions,
): Promise<{ items: ZoneMemberView[]; total: number }> {
  const zone = await requireZone(zoneId);
  const status = opts.status === 'pending' ? 'pending' : 'active';
  const q = (opts.q ?? '').trim().slice(0, 64);
  const roleKey = (opts.roleKey ?? '').trim();
  const skip = clampInt(opts.skip, 0, 0, 1_000_000);
  const take = clampInt(opts.take, 50, 1, 200);

  // The owner is listed first on page 1 whenever the filters admit them; the
  // paged query then covers everyone else.
  const ownerAdmitted = status === 'active' && (!roleKey || roleKey === ZONE_OWNER_ROLE_KEY);
  let ownerRow: MemberRow | null = null;
  if (ownerAdmitted) {
    ownerRow = await prisma.zoneMember.findFirst({
      where: { zoneId, userId: zone.ownerId, ...(q ? memberSearchWhere(q) : {}) },
      select: MEMBER_SELECT,
    });
    if (!ownerRow && !q) {
      // Defensive: a zone whose owner row vanished still shows its 主版主.
      const owner = await prisma.user.findUnique({ where: { id: zone.ownerId }, select: AUTHOR_IDENTITY_FIELDS });
      if (owner) {
        ownerRow = {
          id: `owner:${zone.ownerId}`,
          userId: zone.ownerId,
          status: 'active',
          title: '',
          message: '',
          joinedAt: zone.createdAt,
          createdAt: zone.createdAt,
          roleId: null,
          role: null,
          user: owner,
        };
      }
    }
  }
  const ownerCount = ownerRow ? 1 : 0;

  const and: Prisma.ZoneMemberWhereInput[] = [{ userId: { not: zone.ownerId } }];
  if (q) and.push(memberSearchWhere(q));
  if (roleKey) and.push(roleFilter(roleKey, zone.ownerId));
  const where: Prisma.ZoneMemberWhereInput = { zoneId, status, AND: and };

  const mainSkip = Math.max(0, skip - ownerCount);
  const mainTake = skip === 0 ? take - ownerCount : take;
  const [othersTotal, rows] = await Promise.all([
    roleKey === ZONE_OWNER_ROLE_KEY ? Promise.resolve(0) : prisma.zoneMember.count({ where }),
    roleKey === ZONE_OWNER_ROLE_KEY || mainTake <= 0
      ? Promise.resolve([] as MemberRow[])
      : prisma.zoneMember.findMany({
          where,
          orderBy: [{ role: { sortOrder: 'asc' } }, { joinedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
          skip: mainSkip,
          take: mainTake,
          select: MEMBER_SELECT,
        }),
  ]);

  const pageRows = skip === 0 && ownerRow ? [ownerRow, ...rows] : rows;
  const [memberRoleName, postCounts] = await Promise.all([
    memberRoleNameFor(zoneId),
    postCountsFor(
      zoneId,
      pageRows.map((r) => r.userId),
    ),
  ]);
  const ctx: MemberViewCtx = {
    ownerId: zone.ownerId,
    memberRoleName,
    canSeeIdentity: opts.canSeeIdentity,
    includeMessage: opts.includeMessage,
    postCounts,
  };
  return { items: pageRows.map((r) => toMemberView(r, ctx)), total: othersTotal + ownerCount };
}

async function memberViewFor(zoneId: string, userId: string, canSeeIdentity: boolean, includeMessage: boolean): Promise<ZoneMemberView> {
  const [zone, row, memberRoleName, postCounts] = await Promise.all([
    requireZone(zoneId),
    prisma.zoneMember.findUnique({ where: { zoneId_userId: { zoneId, userId } }, select: MEMBER_SELECT }),
    memberRoleNameFor(zoneId),
    postCountsFor(zoneId, [userId]),
  ]);
  if (!row) throw new ZoneError('not_member', 404);
  return toMemberView(row, { ownerId: zone.ownerId, memberRoleName, canSeeIdentity, includeMessage, postCounts });
}

/**
 * 加入 / 申请加入. open ⇒ active (+recount); approval ⇒ pending row carrying the
 * note; invite ⇒ ZoneError('invite_only', 403). Idempotent: an existing active
 * row answers 'joined', an existing pending row answers 'pending'.
 */
export async function joinZone(zone: ZoneAccessRow, userId: string, message: string): Promise<'joined' | 'pending'> {
  if (zone.ownerId === userId) return 'joined';
  const note = message.trim().slice(0, ZONE_LIMITS.joinMessageMax);
  const existing = await prisma.zoneMember.findUnique({
    where: { zoneId_userId: { zoneId: zone.id, userId } },
    select: { status: true },
  });
  if (existing?.status === 'active') return 'joined';
  if (existing?.status === 'pending') return 'pending';
  if (zone.joinPolicy === 'invite') throw new ZoneError('invite_only', 403);

  try {
    if (zone.joinPolicy === 'open') {
      await prisma.$transaction(async (tx) => {
        await tx.zoneMember.create({
          data: { zoneId: zone.id, userId, status: 'active', joinedAt: new Date(), message: '' },
        });
        await recountZone(zone.id, tx);
      });
      return 'joined';
    }
    await prisma.zoneMember.create({ data: { zoneId: zone.id, userId, status: 'pending', message: note } });
    return 'pending';
  } catch (e) {
    if (isUniqueViolation(e)) {
      // A second tab won the race — answer with whatever state exists now.
      const fresh = await prisma.zoneMember.findUnique({
        where: { zoneId_userId: { zoneId: zone.id, userId } },
        select: { status: true },
      });
      return fresh?.status === 'active' ? 'joined' : 'pending';
    }
    if (isForeignKeyViolation(e)) throw new ZoneError('user_not_found', 404);
    throw e;
  }
}

/** Leave (or withdraw a pending request). Owner ⇒ ZoneError('owner_cannot_leave'). */
export async function leaveZone(zoneId: string, userId: string): Promise<boolean> {
  const zone = await requireZone(zoneId);
  if (zone.ownerId === userId) throw new ZoneError('owner_cannot_leave');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.zoneMember.findUnique({
      where: { zoneId_userId: { zoneId, userId } },
      select: { status: true },
    });
    if (!existing) return false;
    const r = await tx.zoneMember.deleteMany({ where: { zoneId, userId } });
    if (r.count === 0) return false;
    if (existing.status === 'active') await recountZone(zoneId, tx);
    return true;
  });
}

async function requireZoneRole(zoneId: string, roleId: string, db: Db = prisma): Promise<ZoneRoleRow> {
  const role = await db.zoneRole.findFirst({ where: { id: roleId, zoneId }, select: ZONE_ROLE_SELECT });
  if (!role) throw new ZoneError('unknown_role');
  return role;
}

/**
 * The permissions carried by a member's CURRENT ZoneRole ([] for the implicit
 * `member` role / a non-member). Routes compare it against their own `roles`
 * permission so a members-manager can never demote or overwrite the zone's
 * role admin — the mirror image of canAssignZoneRole, which guards the role
 * being handed OUT.
 */
export async function zoneMemberRolePermissions(zoneId: string, userId: string): Promise<string[]> {
  const row = await prisma.zoneMember.findUnique({
    where: { zoneId_userId: { zoneId, userId } },
    select: { role: { select: { permissions: true } } },
  });
  return row?.role?.permissions ?? [];
}

/**
 * Manager adds a member directly (upserts a pending request into active).
 * `canSeeIdentity` is the ACTING viewer's site `identity` permission — the
 * returned view goes back to them, so a private target's 部门/研究所 must be
 * trimmed unless they hold it (defaults to the private reading).
 */
export async function addZoneMember(
  zoneId: string,
  userId: string,
  roleId: string | null,
  invitedById: string,
  canSeeIdentity = false,
): Promise<ZoneMemberView> {
  const zone = await requireZone(zoneId);
  if (zone.ownerId === userId) return memberViewFor(zoneId, userId, canSeeIdentity, false);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true } });
  if (!user || !user.isActive) throw new ZoneError('user_not_found', 404);
  if (roleId) await requireZoneRole(zoneId, roleId);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.zoneMember.findUnique({
      where: { zoneId_userId: { zoneId, userId } },
      select: { status: true, joinedAt: true },
    });
    const now = new Date();
    if (!existing) {
      await tx.zoneMember.create({
        data: { zoneId, userId, roleId, status: 'active', joinedAt: now, invitedById, message: '' },
      });
    } else {
      await tx.zoneMember.update({
        where: { zoneId_userId: { zoneId, userId } },
        data: { roleId, status: 'active', joinedAt: existing.joinedAt ?? now, invitedById, message: '' },
      });
    }
    if (!existing || existing.status !== 'active') await recountZone(zoneId, tx);
  });
  return memberViewFor(zoneId, userId, canSeeIdentity, false);
}

/** 通过 / 拒绝 a pending request; false when no pending row existed (already decided). */
export async function reviewJoinRequest(zoneId: string, userId: string, approve: boolean): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    if (approve) {
      const r = await tx.zoneMember.updateMany({
        where: { zoneId, userId, status: 'pending' },
        data: { status: 'active', joinedAt: new Date() },
      });
      if (r.count === 0) return false;
      await recountZone(zoneId, tx);
      return true;
    }
    const r = await tx.zoneMember.deleteMany({ where: { zoneId, userId, status: 'pending' } });
    return r.count > 0;
  });
}

/** Role / 头衔 changes for an active member; the owner row is untouchable. */
export async function updateZoneMember(
  zoneId: string,
  userId: string,
  patch: { roleId?: string | null; title?: string },
): Promise<void> {
  const zone = await requireZone(zoneId);
  if (zone.ownerId === userId) throw new ZoneError('owner_untouchable');
  const data: Prisma.ZoneMemberUncheckedUpdateManyInput = {};
  if (patch.roleId !== undefined) {
    if (patch.roleId) await requireZoneRole(zoneId, patch.roleId);
    data.roleId = patch.roleId;
  }
  if (patch.title !== undefined) data.title = patch.title.trim().slice(0, ZONE_LIMITS.memberTitleMax);
  if (Object.keys(data).length === 0) return;
  const r = await prisma.zoneMember.updateMany({ where: { zoneId, userId, status: 'active' }, data });
  if (r.count === 0) throw new ZoneError('not_member', 404);
}

/** Remove a member (any status). Owner ⇒ ZoneError('owner_untouchable'). */
export async function removeZoneMember(zoneId: string, userId: string): Promise<boolean> {
  const zone = await requireZone(zoneId);
  if (zone.ownerId === userId) throw new ZoneError('owner_untouchable');
  return prisma.$transaction(async (tx) => {
    const existing = await tx.zoneMember.findUnique({
      where: { zoneId_userId: { zoneId, userId } },
      select: { status: true },
    });
    if (!existing) return false;
    const r = await tx.zoneMember.deleteMany({ where: { zoneId, userId } });
    if (r.count === 0) return false;
    if (existing.status === 'active') await recountZone(zoneId, tx);
    return true;
  });
}

// ─── Roles ──────────────────────────────────────────────────────────────────

/** Roles with active holder counts; the implicit `member` role also counts roleId-null members (owner excluded). */
export async function listZoneRoles(zoneId: string): Promise<ZoneRoleView[]> {
  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, select: { ownerId: true } });
  if (!zone) return [];
  const [rows, implicitMembers] = await Promise.all([
    prisma.zoneRole.findMany({
      where: { zoneId },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      select: { ...ZONE_ROLE_SELECT, _count: { select: { members: { where: { status: 'active' } } } } },
    }),
    implicitMemberCount(zoneId, zone.ownerId),
  ]);
  return rows.map((r) => toRoleView(r, r.key === ZONE_MEMBER_ROLE_KEY ? r._count.members + implicitMembers : r._count.members));
}

/** Active members on the implicit role (roleId null) — the owner's row also has roleId null but is not a `member`. */
function implicitMemberCount(zoneId: string, ownerId: string): Promise<number> {
  return prisma.zoneMember.count({ where: { zoneId, status: 'active', roleId: null, userId: { not: ownerId } } });
}

export interface ZoneRoleInput {
  key: string;
  name: string;
  description?: string | null;
  permissions: string[];
}

function normalizeRoleKey(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!ZONE_ROLE_KEY_RE.test(key) || SYSTEM_ROLE_KEYS.has(key)) throw new ZoneError('invalid_role_key');
  return key;
}

function normalizeRoleName(raw: string): string {
  const name = raw.trim().slice(0, ZONE_LIMITS.roleNameMax);
  if (!name) throw new ZoneError('invalid_input');
  return name;
}

function normalizeRoleDescription(raw: string | null | undefined): string | null {
  const d = (raw ?? '').trim().slice(0, ZONE_LIMITS.roleDescriptionMax);
  return d || null;
}

async function roleMemberCount(zoneId: string, role: { id: string; key: string }): Promise<number> {
  const explicit = await prisma.zoneMember.count({ where: { zoneId, status: 'active', roleId: role.id } });
  if (role.key !== ZONE_MEMBER_ROLE_KEY) return explicit;
  const zone = await prisma.zone.findUnique({ where: { id: zoneId }, select: { ownerId: true } });
  if (!zone) return explicit;
  return explicit + (await implicitMemberCount(zoneId, zone.ownerId));
}

/** Custom role: key unique per zone (ZONE_ROLE_KEY_RE, no system keys), ≤ ZONE_LIMITS.maxCustomRoles. */
export async function createZoneRole(zoneId: string, input: ZoneRoleInput): Promise<ZoneRoleView> {
  await requireZone(zoneId);
  const key = normalizeRoleKey(input.key);
  const name = normalizeRoleName(input.name);
  const description = normalizeRoleDescription(input.description);
  const permissions = normalizeZonePermissions(input.permissions);
  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const customCount = await tx.zoneRole.count({ where: { zoneId, isSystem: false } });
        if (customCount >= ZONE_LIMITS.maxCustomRoles) throw new ZoneError('too_many_roles');
        // Custom roles sit between 作者 (50) and 成员 (100) in list order.
        return tx.zoneRole.create({
          data: { zoneId, key, name, description, isSystem: false, permissions, sortOrder: 60 + customCount },
          select: ZONE_ROLE_SELECT,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toRoleView(created, 0);
  } catch (e) {
    if (isUniqueViolation(e)) throw new ZoneError('role_key_taken', 409);
    throw e;
  }
}

/** System roles keep their key (permissions/name editable — `member` included). */
export async function updateZoneRole(zoneId: string, roleId: string, patch: Partial<ZoneRoleInput>): Promise<ZoneRoleView> {
  const role = await prisma.zoneRole.findFirst({ where: { id: roleId, zoneId }, select: ZONE_ROLE_SELECT });
  if (!role) throw new ZoneError('role_not_found', 404);
  const data: Prisma.ZoneRoleUpdateInput = {};
  if (patch.key !== undefined && !role.isSystem) {
    const key = normalizeRoleKey(patch.key);
    if (key !== role.key) data.key = key;
  }
  if (patch.name !== undefined) data.name = normalizeRoleName(patch.name);
  if (patch.description !== undefined) data.description = normalizeRoleDescription(patch.description);
  if (patch.permissions !== undefined) data.permissions = normalizeZonePermissions(patch.permissions);
  let updated: ZoneRoleRow = role;
  if (Object.keys(data).length > 0) {
    try {
      updated = await prisma.zoneRole.update({ where: { id: role.id }, data, select: ZONE_ROLE_SELECT });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ZoneError('role_key_taken', 409);
      throw e;
    }
  }
  return toRoleView(updated, await roleMemberCount(zoneId, updated));
}

/** Holders fall back to the implicit member role (FK is SetNull). */
export async function deleteZoneRole(zoneId: string, roleId: string): Promise<void> {
  const role = await prisma.zoneRole.findFirst({ where: { id: roleId, zoneId }, select: { id: true, isSystem: true } });
  if (!role) throw new ZoneError('role_not_found', 404);
  if (role.isSystem) throw new ZoneError('system_role');
  await prisma.zoneRole.delete({ where: { id: role.id } });
}

// ─── User search (member picker) ────────────────────────────────────────────

export async function searchUsersForZone(
  zoneId: string,
  q: string,
  canSeeIdentity: boolean,
  take = 10,
): Promise<{ userId: string; user: PublicAuthor; membership: 'owner' | 'active' | 'pending' | null }[]> {
  const term = q.trim().slice(0, 64);
  if (!term) return [];
  const contains = { contains: term, mode: 'insensitive' as const };
  const [zone, users] = await Promise.all([
    requireZone(zoneId),
    prisma.user.findMany({
      where: { isActive: true, OR: [{ displayName: contains }, { handle: contains }, { huaweiW3Name: contains }] },
      select: { id: true, ...AUTHOR_IDENTITY_FIELDS },
      orderBy: [{ displayName: 'asc' }, { handle: 'asc' }],
      take: clampInt(take, 10, 1, 50),
    }),
  ]);
  if (users.length === 0) return [];
  const memberships = await prisma.zoneMember.findMany({
    where: { zoneId, userId: { in: users.map((u) => u.id) } },
    select: { userId: true, status: true },
  });
  const byUser = new Map(memberships.map((m) => [m.userId, m.status]));
  return users.map((u) => {
    const status = byUser.get(u.id);
    const membership =
      u.id === zone.ownerId ? 'owner' : status === 'active' ? 'active' : status === 'pending' ? 'pending' : null;
    return { userId: u.id, user: toPublicAuthor(u, canSeeIdentity), membership };
  });
}
