// 技术专区 — 版块内权限目录 + 纯函数判定。
//
// IMPORT-FREE and client-safe (mirrors lib/permissions.ts for the site level).
// Every zone owns a set of `ZoneRole` rows whose `permissions` reference the
// keys below; the catalog itself is code. The 主版主 (`Zone.ownerId`) is implicit
// `*` and can never be demoted from inside the zone (only 转让 / site admin).
// A holder of the SITE permission `zones` (lib/permissions.ts) bypasses zone
// visibility and every zone-level check — that is the moderation backstop.

export type ZonePermissionKey = 'manage' | 'roles' | 'members' | 'post' | 'moderate' | 'wiki' | 'comment';

export interface ZonePermissionDef {
  key: ZonePermissionKey;
  label: string;
  description: string;
}

export const ZONE_PERMISSIONS: readonly ZonePermissionDef[] = [
  { key: 'manage', label: '版块设置', description: '编辑版块名称、简介、封面、组织归属、外链、可见性与加入方式。' },
  { key: 'roles', label: '角色配置', description: '新建 / 编辑 / 删除版块角色并设置其权限（主版主始终拥有；可指派任意角色）。' },
  { key: 'members', label: '成员管理', description: '添加 / 移除成员，审核加入申请，为成员指派角色（不能指派含「角色配置」的角色）。' },
  { key: 'post', label: '发布内容', description: '在本版块发布帖子（文章、研究报告、论文、演示、链接）。' },
  { key: 'moderate', label: '内容治理', description: '置顶、锁定、编辑或删除本版块任意帖子与评论；发布版块公告。' },
  { key: 'wiki', label: '编辑 Wiki', description: '新建、编辑、移动、删除本版块 Wiki 页面并恢复历史版本。' },
  { key: 'comment', label: '评论互动', description: '在本版块的帖子下评论、回复。' },
];

export const ZONE_PERMISSION_KEYS: readonly ZonePermissionKey[] = ZONE_PERMISSIONS.map((p) => p.key);

const KEY_SET: ReadonlySet<string> = new Set(ZONE_PERMISSION_KEYS);

export function isZonePermissionKey(value: string): value is ZonePermissionKey {
  return KEY_SET.has(value);
}

/** Unknown keys dropped, duplicates removed, catalog order restored. */
export function normalizeZonePermissions(input: readonly string[] | null | undefined): ZonePermissionKey[] {
  const wanted = new Set((input ?? []).filter(isZonePermissionKey));
  return ZONE_PERMISSION_KEYS.filter((k) => wanted.has(k));
}

export const ZONE_MODERATOR_ROLE_KEY = 'moderator';
export const ZONE_AUTHOR_ROLE_KEY = 'author';
export const ZONE_MEMBER_ROLE_KEY = 'member';
/** Pseudo role key reported for the 主版主 in access payloads (never stored on ZoneRole). */
export const ZONE_OWNER_ROLE_KEY = 'owner';

export const ZONE_ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

/**
 * Seeded on zone creation (lib/zones/queries.ts#createZone). `member` is the
 * implicit role of any ZoneMember whose roleId is null; it may be edited (e.g.
 * grant `post` so every member can publish) but never deleted.
 */
export const ZONE_SYSTEM_ROLES: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  permissions: ZonePermissionKey[];
  sortOrder: number;
}> = [
  {
    key: ZONE_MODERATOR_ROLE_KEY,
    name: '版主',
    description: '协助主版主维护版块：设置、成员、内容治理、Wiki。',
    permissions: ['manage', 'members', 'post', 'moderate', 'wiki', 'comment'],
    sortOrder: 10,
  },
  {
    key: ZONE_AUTHOR_ROLE_KEY,
    name: '作者',
    description: '可以发布帖子并编辑 Wiki。',
    permissions: ['post', 'wiki', 'comment'],
    sortOrder: 50,
  },
  {
    key: ZONE_MEMBER_ROLE_KEY,
    name: '成员',
    description: '默认角色：阅读与评论。',
    permissions: ['comment'],
    sortOrder: 100,
  },
];

export type ZoneVisibilityValue = 'public' | 'members';
export type ZoneJoinPolicyValue = 'open' | 'approval' | 'invite';
export type ZoneMembershipStatus = 'active' | 'pending';

/**
 * Everything a surface needs to know about ONE viewer looking at ONE zone.
 * Built server-side by lib/zones/access.ts (`resolveZoneAccess`) and shipped to
 * client components as-is (no secrets inside). Booleans are pre-decided so the
 * UI never re-derives policy.
 */
export interface ZoneAccess {
  zoneId: string;
  viewerId: string | null;
  /** Site-level `zones` permission: bypasses visibility and every zone permission. */
  siteAdmin: boolean;
  /** Site-level `identity` permission. */
  canSeeIdentity: boolean;
  isOwner: boolean;
  /** Active membership (owner counts as a member). */
  isMember: boolean;
  membershipStatus: ZoneMembershipStatus | null;
  /** `owner` for the 主版主, the ZoneRole key otherwise, null when not a member. */
  roleKey: string | null;
  roleName: string | null;
  /** Effective zone permissions (owner / siteAdmin ⇒ every key). */
  permissions: ZonePermissionKey[];
  /** May read posts / wiki / members. */
  canRead: boolean;
  /** May click 加入 / 申请加入 right now. */
  canJoin: boolean;
  /** May leave (active member who is not the owner). */
  canLeave: boolean;
  canPost: boolean;
  canComment: boolean;
  canModerate: boolean;
  canWiki: boolean;
  canManage: boolean;
  canManageMembers: boolean;
  canManageRoles: boolean;
}

export interface ZoneAccessInput {
  zone: {
    id: string;
    ownerId: string;
    visibility: ZoneVisibilityValue;
    joinPolicy: ZoneJoinPolicyValue;
    allowGuestComments: boolean;
    deletedAt?: Date | string | null;
  };
  viewerId: string | null;
  /** The viewer's ZoneMember row (any status) with its role, or null. */
  membership: {
    status: ZoneMembershipStatus;
    role: { key: string; name: string; permissions: readonly string[] } | null;
  } | null;
  /** The zone's `member` system role (applied when membership.role is null). */
  memberRole: { key: string; name: string; permissions: readonly string[] } | null;
  siteAdmin: boolean;
  canSeeIdentity: boolean;
}

/** Pure policy: the single place that turns rows into decisions. */
export function buildZoneAccess(input: ZoneAccessInput): ZoneAccess {
  const { zone, viewerId, membership, memberRole, siteAdmin, canSeeIdentity } = input;
  const isOwner = !!viewerId && viewerId === zone.ownerId;
  const active = isOwner || membership?.status === 'active';
  const pending = !isOwner && membership?.status === 'pending';
  const role = active && !isOwner ? (membership?.role ?? memberRole) : null;

  const permissions: ZonePermissionKey[] =
    isOwner || siteAdmin ? [...ZONE_PERMISSION_KEYS] : normalizeZonePermissions(role?.permissions ?? []);
  const has = (k: ZonePermissionKey) => permissions.includes(k);

  const canRead = siteAdmin || zone.visibility === 'public' ? !!viewerId : active;
  const canComment =
    !!viewerId && (siteAdmin || isOwner || (active ? has('comment') : zone.visibility === 'public' && zone.allowGuestComments));

  return {
    zoneId: zone.id,
    viewerId,
    siteAdmin,
    canSeeIdentity,
    isOwner,
    isMember: active,
    membershipStatus: isOwner ? 'active' : (membership?.status ?? null),
    roleKey: isOwner ? ZONE_OWNER_ROLE_KEY : (role?.key ?? null),
    roleName: isOwner ? '主版主' : (role?.name ?? null),
    permissions,
    canRead,
    canJoin: !!viewerId && !active && !pending && zone.joinPolicy !== 'invite',
    canLeave: active && !isOwner,
    canPost: !!viewerId && has('post'),
    canComment,
    canModerate: !!viewerId && has('moderate'),
    canWiki: !!viewerId && has('wiki'),
    canManage: !!viewerId && has('manage'),
    canManageMembers: !!viewerId && has('members'),
    canManageRoles: !!viewerId && (isOwner || siteAdmin || has('roles')),
  };
}

export function zoneCan(access: ZoneAccess | null | undefined, key: ZonePermissionKey): boolean {
  return !!access && access.permissions.includes(key);
}

/** A members-manager may not hand out a role that carries `roles` unless they hold `roles` themselves. */
export function canAssignZoneRole(
  access: ZoneAccess,
  role: { key: string; permissions: readonly string[] },
): boolean {
  if (!access.canManageMembers) return false;
  if (role.permissions.includes('roles') && !access.canManageRoles) return false;
  return true;
}
