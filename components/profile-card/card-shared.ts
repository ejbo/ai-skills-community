// 名片 — pure helpers shared by the three card styles. Plain module (no
// 'use client', no React), so everything here is deterministic on the server
// and the client: the SSR'd card and the hydrated one always agree.

import type { CSSProperties } from 'react';
import type { CardStyle } from '@/lib/profile/shared';
import type { ProfileCardMedia, ProfileCardStatKey, ProfileCardView } from '@/lib/profile/types';

export type ProfileCardSize = 'sm' | 'md' | 'lg';

/** Card width per size, px. Everything inside is authored in units of the 320px card (`--pc-u`). */
export const CARD_WIDTH: Record<ProfileCardSize, number> = { sm: 288, md: 320, lg: 360 };

/** width / height per style (holo + minimal follow React Bits ProfileCard, reflective its ReflectiveCard). */
export const CARD_ASPECT: Record<CardStyle, number> = { holo: 0.718, reflective: 0.64, minimal: 0.718 };

export function cardHeight(style: CardStyle, size: ProfileCardSize): number {
  return Math.round(CARD_WIDTH[size] / CARD_ASPECT[style]);
}

const CJK_RE = /[⺀-鿿가-힯豈-﫿＀-￯]|[\u{20000}-\u{2FA1F}]/u;

/** true when the text contains CJK / fullwidth characters (no uppercase, tighter tracking). */
export function hasCJK(s: string): boolean {
  return CJK_RE.test(s);
}

/**
 * Display size (design units) for a name that must sit on one line of
 * `avail` units. Estimated, not measured: a CJK glyph is ~1em wide, Latin
 * ~0.6em (weight 600, calibrated on the rendered card), so `张伟` gets the
 * full `max` while `Alexandra Konstantinidou` shrinks — never below `min`
 * (past that it ellipsizes). Measuring would need
 * layout, i.e. a post-hydration jump; an estimate renders the same on the
 * server as on the client.
 */
export function fitNameSize(name: string, max: number, min: number, avail: number): number {
  let em = 0;
  for (const ch of Array.from(name)) {
    if (CJK_RE.test(ch)) em += 1.02;
    else if (/[\s]/.test(ch)) em += 0.3;
    else if (/[.,'’·ilIjtf|!:;()]/.test(ch)) em += 0.34;
    else if (/[MWmw@%&]/.test(ch)) em += 0.86;
    else if (/[A-Z0-9#]/.test(ch)) em += 0.7;
    else em += 0.6;
  }
  if (em <= 0) return max;
  return Math.max(min, Math.min(max, Math.floor((avail / em) * 10) / 10));
}

/** First visible character (code-point safe), uppercased for Latin. */
export function initialOf(name: string): string {
  const first = Array.from(name.trim())[0] ?? 'U';
  return first.toUpperCase();
}

function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * `hex` mixed toward white by `t` (0–1) → `rgb(r, g, b)`. Used for the
 * gradient text ends (React Bits hard-codes a periwinkle; ours follows the
 * member's theme). Built from numbers only.
 */
export function tintHex(hex: string, t: number, alpha = 1): string {
  const rgb = hexRgb(hex) ?? [92, 91, 166];
  const k = Math.min(1, Math.max(0, t));
  const [r, g, b] = rgb.map((c) => Math.round(c + (255 - c) * k));
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** `'x% y%'` → numbers (centre when empty / malformed). */
export function posToXY(pos: string): [number, number] {
  const m = /^(\d{1,3})% (\d{1,3})%$/.exec(pos.trim());
  if (!m) return [50, 50];
  return [Math.min(100, Number(m[1])), Math.min(100, Number(m[2]))];
}

export function xyToPos(x: number, y: number): string {
  const c = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
  return `${c(x)}% ${c(y)}%`;
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * `12`, `1.2K` → shown as `1.2k`. Pinned to en-US on purpose (like the GitHub
 * 热榜): a figure on a card must be the same short string for every viewer,
 * and `1.2万` would change the card's width per locale.
 */
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.trunc(n));
  return COMPACT.format(n).toLowerCase();
}

/** Badges shown side by side before the "+N" chip, per card size (the hover card is `sm`). */
export const CARD_BADGE_MAX: Record<ProfileCardSize, number> = { sm: 2, md: 3, lg: 3 };

/** i18n key (namespace `profile`) of a stat's short label. */
export const STAT_LABEL_KEY: Record<ProfileCardStatKey, string> = {
  skills: 'card_stat_skills',
  docs: 'card_stat_docs',
  posts: 'card_stat_posts',
  videos: 'card_stat_videos',
  downloads: 'card_stat_downloads',
  likes: 'card_stat_likes',
};

/** Year of an ISO date in UTC (a join year must not differ between server and client zones). */
export function isoYear(iso: string): number | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear();
}

/** Whether a card can show SOMETHING for this media without motion (image, or a video poster). */
export function mediaHasStill(media: ProfileCardMedia | null): boolean {
  if (!media) return false;
  return media.kind === 'image' ? !!media.url : !!media.posterUrl;
}

/** A media value is usable when it can show a still frame or play something. */
export function usableMedia(media: ProfileCardMedia | null): ProfileCardMedia | null {
  if (!media) return null;
  if (mediaHasStill(media)) return media;
  return media.kind === 'video' && media.playUrl ? media : null;
}

export function deptText(view: ProfileCardView): string {
  return [view.department, view.lab].filter(Boolean).join(' · ');
}

/** `@handle`, or the display name for a 隐私账号 seen without `identity`. */
export function handleText(view: ProfileCardView): string {
  return view.showHandle ? `@${view.handle}` : view.displayName;
}

/** `--pc-name-size` in design units. */
export function nameSizeVar(units: number): CSSProperties {
  return { '--pc-name-size': `calc(var(--pc-u) * ${units})` } as CSSProperties;
}
