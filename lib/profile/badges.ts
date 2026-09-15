// 名片徽章 — the ONE place a member's badges are assembled (hover card API,
// profile page and the settings preview all go through loadProfileBadges via
// lib/profile/card-view.ts).
//
// Order is fixed: an HONORIFIC role first (专家 — a role with an empty
// permission list), then the member's VISIBLE tags in admin sort order. Staff
// roles never get here: publicRoleBadge trims them at this server boundary, so
// 超级管理员/管理员 cannot leak onto a card no matter what the client does.
// Hidden tag assignments (设置 → 我的标签) are excluded by syncAndLoadUserTags.

import { publicRoleBadge } from '@/lib/permissions';
import { syncAndLoadUserTags, toPublicUserTag, type PublicUserTag } from '@/lib/user-tags';
import type { ProfileBadge } from '@/lib/profile/types';

/**
 * Roles have no colour column; 荣誉身份 reads as gold everywhere so it is never
 * mistaken for an admin-granted tag of the same name.
 */
export const ROLE_BADGE_COLOR = 'amber';

/**
 * `role:` prefix keeps a role badge's key disjoint from tag keys (tag keys match
 * /^[a-z][a-z0-9_]+$/ and can never contain a colon), so a 专家 role and an
 * `expert` tag can sit in one list. Tag badges keep the RAW tag key — that is
 * what PATCH /api/me/tags expects back.
 */
export function roleBadgeKey(roleKey: string): string {
  return `role:${roleKey}`;
}

export function roleBadge(
  role: { key: string; name: string; description?: string | null; permissions?: readonly string[] | null } | null | undefined,
): ProfileBadge | null {
  const b = publicRoleBadge(role ? { ...role, description: role.description ?? null } : role);
  if (!b) return null;
  return {
    key: roleBadgeKey(b.key),
    name: b.name,
    description: b.description?.trim() || null,
    color: ROLE_BADGE_COLOR,
    icon: null,
    kind: 'role',
    grantedAt: null,
  };
}

export function tagBadge(tag: PublicUserTag): ProfileBadge {
  return {
    key: tag.key,
    name: tag.name,
    description: tag.description,
    color: tag.color,
    icon: tag.icon,
    kind: tag.kind,
    grantedAt: tag.grantedAt,
  };
}

/** A `loadOwnTags` row → badge (settings → 我的标签 renders the real chip). */
export function ownTagBadge(row: {
  createdAt: Date;
  tag: { key: string; name: string; description: string | null; color: string; icon: string | null; kind: 'manual' | 'auto' };
}): ProfileBadge {
  return tagBadge(toPublicUserTag(row.tag, row.createdAt));
}

/** Pure assembly — role first, then tags; a tag can never duplicate a role key (see roleBadgeKey). */
export function assembleBadges(role: ProfileBadge | null, tags: readonly PublicUserTag[]): ProfileBadge[] {
  const out: ProfileBadge[] = role ? [role] : [];
  const seen = new Set(out.map((b) => b.key));
  for (const t of tags) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(tagBadge(t));
  }
  return out;
}

/**
 * Everything a member-facing surface may show for this member. The role must
 * be selected with `key, name, description, permissions` — without
 * `permissions` publicRoleBadge cannot tell a staff role from an honorific one.
 *
 * `anonymous` (a logged-out viewer of /users/[handle]): badges derived from a
 * login-walled domain are left out and the auto-tag reconcile is skipped — see
 * syncAndLoadUserTags.
 */
export async function loadProfileBadges(
  user: {
    id: string;
    role: { key: string; name: string; description: string | null; permissions: string[] } | null;
  },
  opts: { anonymous?: boolean } = {},
): Promise<ProfileBadge[]> {
  const tags = await syncAndLoadUserTags(user.id, { anonymous: !!opts.anonymous });
  return assembleBadges(roleBadge(user.role), tags);
}
