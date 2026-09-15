// 名片 view builder — the ONE place a ProfileCardView is assembled. The hover
// card API (GET /api/users/[handle]/card), the profile page hero and the card
// editor preview all call loadProfileCardView, so the three can never show a
// member differently.
//
// Everything that decides WHAT a viewer may see happens here, server-side:
//   - identity: department/lab trimmed exactly like toPublicAuthor; the @handle
//     TEXT is suppressed for 隐私账号 unless the viewer holds `identity`
//   - badges: honorific role + visible tags only (lib/profile/badges.ts)
//   - stats: counted ONLY for sections this viewer may open (SPEC §3.1) — a
//     section the member hid is never even queried for someone else, which also
//     closes the old leak where the card counted what the profile hid
//   - media: keys → URLs rebuilt here (never stored), every file stat'ed; a key
//     whose file is gone reads as "no media" instead of a broken <img>. A video
//     is published ONLY as its poster + generated muted loop — the uploaded
//     original (full length, audio, container metadata) never enters a view
//   - badges: an anonymous viewer gets no badge derived from a login-walled
//     domain (版主 comes from /zones) and never triggers the auto-tag reconcile
//
// loadOwnProfileSettings is the owner's untrimmed read-back for the editors.

import { prisma } from '@/lib/db';
import { identityColor } from '@/lib/identity-color';
import { DISCOVERABLE_SKILL_WHERE } from '@/lib/skill-queries';
import { BROWSABLE_DOC_WHERE } from '@/lib/library-queries';
import { loadProfileBadges } from '@/lib/profile/badges';
import { statProfileMedia } from '@/lib/profile/card-media-storage';
import { PUBLISHED_PUBLIC } from '@/lib/video/queries';
import { SHORTS_PUBLIC } from '@/lib/video/shorts-queries';
import {
  LEGACY_PROFILE_FLAGS_SELECT,
  isLoginOnlySection,
  isValidProfileMediaKey,
  parseCardConfig,
  parseProfileLayout,
  profileMediaUrl,
  sanitizeAbout,
  sanitizeHeadline,
  sanitizeInterests,
  sanitizePins,
  sanitizeProfileLinks,
  sliceCodePoints,
  type ProfileLayout,
  type ProfileSection,
} from '@/lib/profile/shared';
import type {
  OwnProfileSettings,
  ProfileCardMedia,
  ProfileCardStat,
  ProfileCardStatKey,
  ProfileCardView,
} from '@/lib/profile/types';

export interface ProfileCardViewer {
  id: string;
  /** can(session.user, 'identity') — sees 隐私账号 department/lab and hidden sections. */
  canSeeIdentity: boolean;
}

/** 签名 is a textarea (≤240 on write); the card clamps it visually, this bounds the payload. */
const CARD_BIO_MAX = 240;
/** Figures a card has room for. */
export const CARD_STATS_MAX = 3;

// ─── Pure helpers (tests/profile-store.test.ts) ─────────────────────────────

/**
 * SPEC §3.1 `sectionAllowed`: login-walled sources need a session, and a
 * section the member hid is visible only to the member and `identity` holders.
 */
export function profileSectionAllowed(
  section: ProfileSection,
  layout: ProfileLayout,
  who: { loggedIn: boolean; canSeeHidden: boolean },
): boolean {
  if (isLoginOnlySection(section) && !who.loggedIn) return false;
  return !layout.hidden.includes(section) || who.canSeeHidden;
}

/** Which layout sections feed each card figure. `posts` = 动态 + 论坛话题. */
export const CARD_STAT_SECTIONS: Record<'skills' | 'docs' | 'posts' | 'videos', readonly ProfileSection[]> = {
  skills: ['skills'],
  docs: ['docs'],
  posts: ['posts', 'topics'],
  videos: ['videos'],
};

export interface CardStatCandidate {
  key: ProfileCardStatKey;
  value: number;
  /** Position in the member's layout (the earliest of the stat's sections). */
  order: number;
}

/**
 * The figures a card shows: non-zero only, in the member's own section order,
 * at most `max`. Zeros are dropped on purpose — "0 Skills · 0 文档" says nothing
 * on a card, and leaving them out also means a viewer cannot tell an empty
 * section from one they are not allowed to count.
 */
export function pickCardStats(candidates: readonly CardStatCandidate[], max = CARD_STATS_MAX): ProfileCardStat[] {
  return candidates
    .filter((c) => Number.isFinite(c.value) && c.value > 0)
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map(({ key, value }) => ({ key, value }));
}

export interface CardMediaKeys {
  kind: string | null;
  media: string | null;
  poster: string | null;
  loop: string | null;
}

/**
 * File sizes the media decision needs; null = missing / unusable. `media` is
 * only read for an image — a video original is never shown, so it is not stat'ed.
 */
export interface CardMediaFiles {
  media: number | null;
  poster: number | null;
  loop: number | null;
}

/**
 * Keys + on-disk sizes → the media a card renders. Pure, so the rule is testable
 * without a disk:
 *   image — the photo, or nothing when its file is gone
 *   video — the generated loop (playUrl) and/or the poster; `url` = loop ?? poster.
 *           The ORIGINAL is never referenced: it has the full length, the audio and
 *           the phone's metadata, while the member was promised an 8 s muted loop
 *           (and the serving route refuses `video/` keys anyway). Neither a loop
 *           nor a poster ⇒ null, so a card falls back to avatar/monogram instead
 *           of an empty frame.
 */
export function decideCardMedia(keys: CardMediaKeys, files: CardMediaFiles): ProfileCardMedia | null {
  const ok = (n: number | null) => n !== null && n > 0;
  if (keys.kind === 'image') {
    if (!isValidProfileMediaKey(keys.media, 'image') || !ok(files.media)) return null;
    return { kind: 'image', url: profileMediaUrl(keys.media), posterUrl: null, playUrl: null };
  }
  if (keys.kind === 'video') {
    if (!isValidProfileMediaKey(keys.media, 'video')) return null;
    const posterUrl =
      isValidProfileMediaKey(keys.poster, 'poster') && ok(files.poster) ? profileMediaUrl(keys.poster) : null;
    const playUrl = isValidProfileMediaKey(keys.loop, 'loop') && ok(files.loop) ? profileMediaUrl(keys.loop) : null;
    const url = playUrl ?? posterUrl;
    return url ? { kind: 'video', url, posterUrl, playUrl } : null;
  }
  return null;
}

// ─── Disk-backed ────────────────────────────────────────────────────────────

async function sizeOf(key: string | null): Promise<number | null> {
  const st = await statProfileMedia(key);
  return st ? st.size : null;
}

/** Stat the stored keys and decide the card media (shared by the view, the settings read-back and the media PUT). */
export async function resolveCardMedia(keys: CardMediaKeys): Promise<ProfileCardMedia | null> {
  if (keys.kind !== 'image' && keys.kind !== 'video') return null;
  const isVideo = keys.kind === 'video';
  const [media, poster, loop] = await Promise.all([
    isVideo ? Promise.resolve(null) : sizeOf(keys.media),
    isVideo ? sizeOf(keys.poster) : Promise.resolve(null),
    isVideo ? sizeOf(keys.loop) : Promise.resolve(null),
  ]);
  return decideCardMedia(keys, { media, poster, loop });
}

// ─── Loaders ────────────────────────────────────────────────────────────────

const PROFILE_CARD_SELECT = {
  headline: true,
  layout: true,
  card: true,
  cardMediaKind: true,
  cardMediaKey: true,
  cardPosterKey: true,
  cardLoopKey: true,
} as const;

const CARD_USER_SELECT = {
  id: true,
  handle: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  department: true,
  lab: true,
  isPrivate: true,
  isActive: true,
  createdAt: true,
  ...LEGACY_PROFILE_FLAGS_SELECT,
  // `permissions` is load-bearing: publicRoleBadge needs it to drop staff roles.
  role: { select: { key: true, name: true, description: true, permissions: true } },
  profile: { select: PROFILE_CARD_SELECT },
} as const;

/** Count the card figures, skipping every section the viewer may not open (those are never queried). */
async function countCardStats(
  userId: string,
  layout: ProfileLayout,
  allowed: (s: ProfileSection) => boolean,
): Promise<ProfileCardStat[]> {
  const orderOf = (key: keyof typeof CARD_STAT_SECTIONS) =>
    Math.min(...CARD_STAT_SECTIONS[key].map((s) => layout.order.indexOf(s)).filter((i) => i >= 0), 999);
  const zero = Promise.resolve(0);

  const [skills, docs, posts, topics, videos] = await Promise.all([
    allowed('skills') ? prisma.skill.count({ where: { authorId: userId, ...DISCOVERABLE_SKILL_WHERE } }) : zero,
    allowed('docs') ? prisma.libraryDoc.count({ where: { uploaderId: userId, ...BROWSABLE_DOC_WHERE } }) : zero,
    allowed('posts') ? prisma.post.count({ where: { authorId: userId } }) : zero,
    allowed('topics') ? prisma.discussionTopic.count({ where: { authorId: userId } }) : zero,
    // Public shorts + published public long videos — exactly the profile hero's
    // 视频 figure (lib/profile/queries.ts countSection('videos')). The card and
    // the figures strip sit side by side on /users/[handle]; two definitions
    // showed "3" next to "8" for the same member.
    allowed('videos')
      ? Promise.all([
          prisma.video.count({ where: { ...SHORTS_PUBLIC, uploaderId: userId } }),
          prisma.video.count({ where: { ...PUBLISHED_PUBLIC, uploaderId: userId } }),
        ]).then(([shorts, longs]) => shorts + longs)
      : zero,
  ]);

  return pickCardStats([
    { key: 'skills', value: skills, order: orderOf('skills') },
    { key: 'docs', value: docs, order: orderOf('docs') },
    { key: 'posts', value: posts + topics, order: orderOf('posts') },
    { key: 'videos', value: videos, order: orderOf('videos') },
  ]);
}

/**
 * The ONE builder of a ProfileCardView (hover card API + profile page + editor preview).
 * null ⇒ no such active user. `viewer` null ⇒ anonymous.
 */
export async function loadProfileCardView(
  handle: string,
  viewer: ProfileCardViewer | null,
): Promise<ProfileCardView | null> {
  if (typeof handle !== 'string' || !handle || handle.length > 200) return null;
  const user = await prisma.user.findUnique({ where: { handle }, select: CARD_USER_SELECT });
  if (!user || !user.isActive) return null;

  const profile = user.profile;
  const layout = parseProfileLayout(profile?.layout ?? null, user);
  const card = parseCardConfig(profile?.card);

  const isOwner = !!viewer && viewer.id === user.id;
  const canSeeIdentity = !!viewer?.canSeeIdentity;
  const who = { loggedIn: !!viewer, canSeeHidden: isOwner || canSeeIdentity };
  const allowed = (s: ProfileSection) => profileSectionAllowed(s, layout, who);

  const hideIdentity = user.isPrivate && !canSeeIdentity;

  const [badges, stats, media] = await Promise.all([
    // Anonymous: no reconcile write, and no badge derived from a login-walled domain.
    loadProfileBadges({ id: user.id, role: user.role }, { anonymous: !viewer }),
    countCardStats(user.id, layout, allowed),
    resolveCardMedia({
      kind: profile?.cardMediaKind ?? null,
      media: profile?.cardMediaKey ?? null,
      poster: profile?.cardPosterKey ?? null,
      loop: profile?.cardLoopKey ?? null,
    }),
  ]);

  return {
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl ?? null,
    showHandle: !user.isPrivate || canSeeIdentity,
    department: hideIdentity ? null : user.department || null,
    lab: hideIdentity ? null : user.lab || null,
    headline: sanitizeHeadline(profile?.headline),
    bio: sliceCodePoints((user.bio ?? '').trim(), CARD_BIO_MAX),
    card,
    // Same hash input as Avatar's fallback badge, so a card without a chosen
    // colour wears the hue the member's initial disc already has everywhere.
    theme: card.theme ?? identityColor(user.displayName?.trim() || 'U').toLowerCase(),
    media,
    badges,
    stats,
    joinedAt: user.createdAt.toISOString(),
  };
}

/** What the settings editors start from (the owner's own, untrimmed values). */
export async function loadOwnProfileSettings(userId: string): Promise<OwnProfileSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      bannerUrl: true,
      ...LEGACY_PROFILE_FLAGS_SELECT,
      profile: {
        select: {
          headline: true,
          aboutMd: true,
          interests: true,
          links: true,
          layout: true,
          pins: true,
          card: true,
          cardMediaKind: true,
          cardMediaKey: true,
          cardPosterKey: true,
          cardLoopKey: true,
        },
      },
    },
  });
  const p = user?.profile ?? null;
  const kind: 'image' | 'video' | null =
    p?.cardMediaKind === 'image' ? 'image' : p?.cardMediaKind === 'video' ? 'video' : null;
  const mediaKeys = {
    kind,
    media: p?.cardMediaKey ?? null,
    poster: p?.cardPosterKey ?? null,
    loop: p?.cardLoopKey ?? null,
  };
  const layout = parseProfileLayout(p?.layout ?? null, user ?? null);

  return {
    headline: sanitizeHeadline(p?.headline),
    aboutMd: sanitizeAbout(p?.aboutMd),
    interests: sanitizeInterests(p?.interests),
    links: sanitizeProfileLinks(p?.links),
    layout: { order: layout.order, hidden: layout.hidden },
    pins: sanitizePins(p?.pins),
    card: parseCardConfig(p?.card),
    media: await resolveCardMedia(mediaKeys),
    mediaKeys,
    bannerUrl: user?.bannerUrl ?? null,
  };
}
