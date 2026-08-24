// 角色与权限 — 权限目录 + 纯函数判定。
//
// IMPORT-FREE and client-safe: the manage UI renders the catalog, the session
// carries a permission list, and every gate (RSC, API, client hint) decides
// through `hasPermission`. Roles live in the `Role` table (lib/roles.ts) and
// reference these keys; the catalog itself is code, so a new domain is added
// HERE (one entry) and then granted to roles in 管理后台 → 角色与权限.
//
// Model: ONE role per user (`User.roleId`, null ⇒ 普通成员). A role is a named
// set of permission keys. `super_admin` is special-cased by KEY (not by its
// permission list): it has every permission, is the only role that may manage
// roles / assign roles, and can never be edited into something weaker.
// `User.isAdmin` survives as a derived "staff" cache (any permission at all)
// so the coarse checks — 管理后台 entry link, admin badges — keep working;
// lib/roles.ts is the only writer of that column.

export const SUPER_ADMIN_ROLE_KEY = 'super_admin';
export const ADMIN_ROLE_KEY = 'admin';
export const MEMBER_ROLE_KEY = 'member';
export const SYSTEM_ROLE_KEYS = [SUPER_ADMIN_ROLE_KEY, ADMIN_ROLE_KEY, MEMBER_ROLE_KEY] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

/** Stored on the super_admin role only; `hasPermission` treats it as "everything". */
export const WILDCARD_PERMISSION = '*';

export type PermissionGroupKey = 'manage' | 'site' | 'identity';

export const PERMISSION_GROUPS: ReadonlyArray<{ key: PermissionGroupKey; label: string; hint: string }> = [
  { key: 'manage', label: '管理后台', hint: '每一项对应后台左侧的一个板块；同时包含该板块在站内的管理操作。' },
  { key: 'site', label: '站内治理', hint: '没有独立后台页面，权限体现在站内内容上的管理操作（置顶、删除、改状态等）。' },
  { key: 'identity', label: '身份信息', hint: '与内容无关，只影响能否看到其他用户被隐藏的身份字段。' },
];

export interface PermissionDef {
  key: string;
  label: string;
  group: PermissionGroupKey;
  description: string;
  /** Manage-panel entry this permission unlocks (nav item + page gate). */
  manageHref?: string;
}

export const PERMISSIONS = [
  // ── 管理后台（顺序 = 后台左侧导航顺序）──────────────────────────────────
  { key: 'dashboard', label: '仪表盘', group: 'manage', manageHref: '/manage', description: '查看后台数据总览。' },
  { key: 'users', label: '用户管理', group: 'manage', manageHref: '/manage/users', description: '查看用户列表与详情（含邮箱/工号/部门等完整账号资料、登录与访问记录），启停账号，调整发布、下载、CLI 等限制。指派角色仅超级管理员可操作。' },
  { key: 'employees', label: '员工名单', group: 'manage', manageHref: '/manage/employees', description: '维护员工名单（新增/导入/同步/停用），用于按工号同步部门与研究所。' },
  { key: 'skills', label: 'Skill 管理', group: 'manage', manageHref: '/manage/skills', description: 'Skill 审核，调整任意 Skill 的状态、可见性、来源；查看与下载任意（含私有/未发布）Skill，处理下载申请，查看下载者名单。' },
  { key: 'packs', label: '合集包', group: 'manage', manageHref: '/manage/packs', description: '创建、编辑、删除合集包。' },
  { key: 'videos', label: '视频管理', group: 'manage', manageHref: '/manage/videos', description: '视频后台（新建/编辑/删除长视频），查看草稿与私有视频，治理视频评论。' },
  { key: 'shorts', label: '短视频', group: 'manage', manageHref: '/manage/shorts', description: '短视频精选、删除任意短视频、重跑字幕，治理短视频评论。' },
  { key: 'discussion', label: '讨论管理', group: 'manage', manageHref: '/manage/discussion', description: '置顶、锁定、删除任意动态、话题、评论与回复。' },
  { key: 'votes', label: '投票活动', group: 'manage', manageHref: '/manage/votes', description: '精选/删除任意投票活动，查看任意活动的数据、票数明细与导出，治理作品评论。' },
  { key: 'library', label: '知识库', group: 'manage', manageHref: '/manage/library', description: '知识库后台与 AI 模型设置，编辑/删除/重新索引任意文档，访问受限与私有文档，治理评论与笔记。' },
  { key: 'categories', label: '类别', group: 'manage', manageHref: '/manage/categories', description: '维护 Skill 类别。' },
  { key: 'announcements', label: '公告', group: 'manage', manageHref: '/manage/announcements', description: '发布、编辑、删除公告；邮件（SMTP）诊断。' },
  { key: 'logs', label: '操作日志', group: 'manage', manageHref: '/manage/logs', description: '查看所有管理员的操作日志。' },
  // ── 站内治理 ─────────────────────────────────────────────────────────────
  { key: 'feedback', label: '意见反馈', group: 'site', description: '修改反馈状态，删除任意反馈与评论。' },
  { key: 'events', label: '活动', group: 'site', description: '置顶活动，取消或编辑任意活动。' },
  { key: 'polls', label: '投票组件', group: 'site', description: '编辑或提前结束任意 [poll] 投票组件。' },
  // ── 身份信息 ─────────────────────────────────────────────────────────────
  { key: 'identity', label: '查看完整身份', group: 'identity', description: '在站内（评论、动态、投票、活动、个人主页等）查看隐私账号的部门/研究所/工号，以及用户在个人主页上隐藏的板块。后台的用户管理/Skill 管理页面按其自身权限显示完整资料。' },
] as const satisfies readonly PermissionDef[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];

export const PERMISSION_KEYS: readonly PermissionKey[] = PERMISSIONS.map((p) => p.key);

const KEY_SET: ReadonlySet<string> = new Set(PERMISSION_KEYS);

export function isPermissionKey(value: string): value is PermissionKey {
  return KEY_SET.has(value);
}

export function permissionDef(key: PermissionKey): PermissionDef {
  return PERMISSIONS.find((p) => p.key === key)!;
}

/** Manage-panel entries in nav order, each with the permission that unlocks it. */
export const MANAGE_SECTIONS: ReadonlyArray<{ href: string; label: string; perm: PermissionKey }> = PERMISSIONS.filter(
  (p): p is (typeof PERMISSIONS)[number] & { manageHref: string } => 'manageHref' in p && !!p.manageHref,
).map((p) => ({ href: p.manageHref, label: p.label, perm: p.key }));

/**
 * Anything that carries a resolved role: `session.user`, a ResolvedUser, or the
 * EffectiveRole from lib/roles.ts. `roleKey` is what makes super_admin work —
 * its permission list is the wildcard, but the KEY is the authority.
 */
export interface PermissionHolder {
  roleKey?: string | null;
  permissions?: readonly string[] | null;
}

export function isSuperAdmin(holder: PermissionHolder | null | undefined): boolean {
  return holder?.roleKey === SUPER_ADMIN_ROLE_KEY;
}

export function hasPermission(holder: PermissionHolder | null | undefined, perm: PermissionKey): boolean {
  if (!holder) return false;
  if (isSuperAdmin(holder)) return true;
  const perms = holder.permissions ?? [];
  return perms.includes(WILDCARD_PERMISSION) || perms.includes(perm);
}

/** Alias that reads naturally at call sites: `can(session.user, 'videos')`. */
export const can = hasPermission;

export function canAny(holder: PermissionHolder | null | undefined, ...perms: PermissionKey[]): boolean {
  return perms.some((p) => hasPermission(holder, p));
}

/**
 * "Staff" = allowed into 管理后台 at all. This is what `User.isAdmin` caches
 * and what the coarse checks (UserMenu link, /manage layout) read.
 */
export function isStaff(holder: PermissionHolder | null | undefined): boolean {
  if (!holder) return false;
  if (isSuperAdmin(holder)) return true;
  const perms = holder.permissions ?? [];
  return perms.includes(WILDCARD_PERMISSION) || perms.some((p) => KEY_SET.has(p));
}

/**
 * Sanitize a permission list coming from the DB or from a form: unknown keys
 * dropped, duplicates removed, catalog order restored. The wildcard is NOT
 * preserved — it is reserved for the super_admin role and only ever written by
 * lib/roles.ts' system-role seed.
 */
export function normalizePermissions(input: readonly string[] | null | undefined): PermissionKey[] {
  const wanted = new Set((input ?? []).filter(isPermissionKey));
  return PERMISSION_KEYS.filter((k) => wanted.has(k));
}

export const ROLE_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

/** Sections of 管理后台 a holder may open, in nav order. */
export function manageSectionsFor(holder: PermissionHolder | null | undefined) {
  return MANAGE_SECTIONS.filter((s) => hasPermission(holder, s.perm));
}

/**
 * Standard viewer handed to lib query helpers (votes, polls, events, library,
 * videos…): who is looking, whether they may MANAGE this domain (moderate /
 * bypass visibility), and — separately — whether they may see private users'
 * full identity. The two are orthogonal on purpose: a 讨论管理员 does not get to
 * read a 隐私账号's 部门 unless the role also carries `identity`.
 */
export interface DomainViewer {
  id: string | null;
  canManage: boolean;
  canSeeIdentity: boolean;
}

export function domainViewer(
  holder: ({ id: string } & PermissionHolder) | null | undefined,
  domain: PermissionKey,
): DomainViewer {
  return {
    id: holder?.id ?? null,
    canManage: hasPermission(holder, domain),
    canSeeIdentity: hasPermission(holder, 'identity'),
  };
}
