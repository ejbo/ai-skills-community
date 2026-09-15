// 个人主页与名片 — every view type that crosses the RSC/API → client boundary.
// Import-free apart from the pure contract, so client components can import it.

import type { BadgeIcon, CardConfig, ProfileLink, ProfilePin, ProfileSection } from '@/lib/profile/shared';

/**
 * A badge as a member-facing surface renders it. Three sources, one shape:
 *   manual — a UserTag an admin granted (管理后台 → 用户标签)
 *   auto   — a UserTag the system reconciles (版主)
 *   role   — an HONORIFIC role (a role with no permissions, e.g. 专家) — staff roles
 *            never reach this type (publicRoleBadge trims them server-side)
 * Hidden tag assignments (设置 → 我的标签) are removed before this is built.
 */
export interface ProfileBadge {
  key: string;
  name: string;
  /** What the title means — shown in the hover detail. */
  description: string | null;
  /** TAG_COLORS token (zinc | blue | green | amber | rose | violet). */
  color: string;
  icon: BadgeIcon | null;
  kind: 'manual' | 'auto' | 'role';
  /** ISO date the member received it; null for roles (no grant ledger). */
  grantedAt: string | null;
}

/**
 * The media a card renders. A video's uploaded ORIGINAL never appears here (nor
 * anywhere public): a card shows the poster and plays the generated ≤ 8 s muted
 * loop, and the serving route 404s every `video/` key. A video with neither a
 * loop nor a poster is no media at all (null), never an unplayable entry.
 */
export interface ProfileCardMedia {
  kind: 'image' | 'video';
  /**
   * image: the photo; video: `playUrl ?? posterUrl` (a still-or-moving picture of
   * the card media, never the original). Root-relative — withBasePath at render.
   */
  url: string;
  /** video only: first frame (always shown under reduced motion / before playback). */
  posterUrl: string | null;
  /** video only: the generated muted hover loop a card may autoplay; null ⇒ poster only. */
  playUrl: string | null;
}

export type ProfileCardStatKey = 'skills' | 'docs' | 'posts' | 'videos' | 'downloads' | 'likes';

export interface ProfileCardStat {
  key: ProfileCardStatKey;
  value: number;
}

/**
 * Everything a <ProfileCard/> renders. Built ONLY by the server helper
 * (lib/profile/card-view.ts#loadProfileCardView) for both the hover card API
 * and the profile page, so the two can never show different things:
 * identity already trimmed for 隐私账号, stats already limited to sections the
 * viewer may see, badges already filtered.
 */
export interface ProfileCardView {
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  /** false ⇒ do not render the `@handle` text (隐私账号 viewed without `identity`). */
  showHandle: boolean;
  department: string | null;
  lab: string | null;
  headline: string;
  /** 签名 (User.bio). */
  bio: string;
  card: CardConfig;
  /** Resolved theme colour (`card.theme` or the identity colour), `#rrggbb`. */
  theme: string;
  media: ProfileCardMedia | null;
  badges: ProfileBadge[];
  stats: ProfileCardStat[];
  joinedAt: string;
}

/** Settings editors read this back (GET /api/me/profile). */
export interface OwnProfileSettings {
  headline: string;
  aboutMd: string;
  interests: string[];
  links: ProfileLink[];
  layout: { order: ProfileSection[]; hidden: ProfileSection[] };
  pins: ProfilePin[];
  card: CardConfig;
  media: ProfileCardMedia | null;
  mediaKeys: { kind: 'image' | 'video' | null; media: string | null; poster: string | null; loop: string | null };
  bannerUrl: string | null;
}
