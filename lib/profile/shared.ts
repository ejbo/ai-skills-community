// 个人主页与名片 — the pure contract. Import-free and client-safe.
//
// ONE module decides what every stored profile value may look like, so the
// page, the settings editors, the API routes and the hover card can never
// disagree about it:
//
//   UserProfile.layout → parseProfileLayout     (板块顺序 + 对外隐藏)
//   UserProfile.card   → parseCardConfig        (名片样式 / 文字 / 开关)
//   UserProfile.links  → sanitizeProfileLinks   (外链，http(s) only)
//   UserProfile.pins   → sanitizePins           (精选置顶)
//   interests/headline/aboutMd → sanitizeInterests / sanitizeHeadline / sanitizeAbout
//   card media keys    → isValidProfileMediaKey (+ on-disk + unique, server-side)
//
// Every sanitizer accepts `unknown` and never throws: garbage degrades to the
// default. They run on WRITE (the API) and again on READ (a hand-edited row or
// a value written by an older release must never crash a render).

// ─── 主页板块 ────────────────────────────────────────────────────────────

/**
 * Every content section the profile can show, in DEFAULT display order.
 * Appending a new section here is safe: `parseProfileLayout` appends missing
 * sections to already-customised layouts, so it can never vanish.
 */
export const PROFILE_SECTIONS = [
  'skills',
  'docs',
  'posts',
  'topics',
  'videos',
  'zones',
  'events',
  'votes',
  'feedback',
  'comments',
  'shelf',
] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export function isProfileSection(v: unknown): v is ProfileSection {
  return typeof v === 'string' && (PROFILE_SECTIONS as readonly string[]).includes(v);
}

/**
 * Sections whose SOURCE surface is login-walled (/videos, /zones, /votes all
 * `requireUser()` in their layout, and their media routes 401). An anonymous
 * profile visitor never gets these tabs and they are never queried for one —
 * a profile must not become a side door around a login wall.
 */
export const LOGIN_ONLY_SECTIONS: readonly ProfileSection[] = ['videos', 'zones', 'votes'];

export function isLoginOnlySection(s: ProfileSection): boolean {
  return LOGIN_ONLY_SECTIONS.includes(s);
}

/** Tabs = 概览 first, the content sections, 工作台 (owner only) last. */
export type ProfileTab = 'overview' | ProfileSection | 'workspace';

export function isProfileTab(v: unknown): v is ProfileTab {
  return v === 'overview' || v === 'workspace' || isProfileSection(v);
}

/** `?tab=` → a tab the viewer may open; anything else falls back to the first allowed (概览). */
export function resolveProfileTab(raw: unknown, allowed: readonly ProfileTab[]): ProfileTab {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (isProfileTab(v) && allowed.includes(v)) return v;
  return allowed[0] ?? 'overview';
}

/** The six pre-2026-09-14 booleans on User. Read-only fallback — never written any more. */
export interface LegacyProfileFlags {
  showProfileSkills: boolean;
  showProfileDocs: boolean;
  showProfilePosts: boolean;
  showProfileComments: boolean;
  showProfileShelf: boolean;
  showProfileEvents: boolean;
}

/** Select fragment for the legacy flags (so callers can pass them to parseProfileLayout). */
export const LEGACY_PROFILE_FLAGS_SELECT = {
  showProfileSkills: true,
  showProfileDocs: true,
  showProfilePosts: true,
  showProfileComments: true,
  showProfileShelf: true,
  showProfileEvents: true,
} as const;

/**
 * Which new sections each legacy flag governed. `showProfilePosts` covered
 * both 动态 and 论坛话题, so both inherit it — the same mapping the migration's
 * backfill uses.
 */
export const LEGACY_FLAG_SECTIONS: Record<keyof LegacyProfileFlags, readonly ProfileSection[]> = {
  showProfileSkills: ['skills'],
  showProfileDocs: ['docs'],
  showProfilePosts: ['posts', 'topics'],
  showProfileComments: ['comments'],
  showProfileShelf: ['shelf'],
  showProfileEvents: ['events'],
};

export interface ProfileLayout {
  /** Every section exactly once, in display order. */
  order: ProfileSection[];
  /** Sections the owner hid from other viewers (owner + `identity` holders still see them, badged). */
  hidden: ProfileSection[];
}

export function defaultProfileLayout(): ProfileLayout {
  return { order: [...PROFILE_SECTIONS], hidden: [] };
}

export function layoutFromLegacyFlags(flags: LegacyProfileFlags): ProfileLayout {
  const fields = Object.keys(LEGACY_FLAG_SECTIONS) as (keyof LegacyProfileFlags)[];
  // A member who switched off EVERY old section was saying "show nothing" —
  // the sections added since (视频/专区/投票/反馈) must not quietly appear on
  // their page. Any narrower choice only speaks for the sections it named.
  if (fields.every((f) => flags[f] === false)) {
    return { order: [...PROFILE_SECTIONS], hidden: [...PROFILE_SECTIONS] };
  }
  const hidden: ProfileSection[] = [];
  for (const field of fields) {
    if (flags[field] === false) for (const s of LEGACY_FLAG_SECTIONS[field]) if (!hidden.includes(s)) hidden.push(s);
  }
  // Keep catalog order so equal layouts compare equal.
  return { order: [...PROFILE_SECTIONS], hidden: PROFILE_SECTIONS.filter((s) => hidden.includes(s)) };
}

/**
 * Parse the stored `UserProfile.layout` (or a PUT body) into a complete layout.
 *
 * `raw` null/undefined means the member never saved a layout — then the legacy
 * booleans decide what is hidden (this is also the safety net for a `db push`
 * deploy that skipped the migration's backfill). Any other value is sanitized:
 * unknown / duplicate ids dropped, missing sections appended in default order.
 */
export function parseProfileLayout(raw: unknown, legacy?: LegacyProfileFlags | null): ProfileLayout {
  if (raw === null || raw === undefined) {
    return legacy ? layoutFromLegacyFlags(legacy) : defaultProfileLayout();
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return defaultProfileLayout();
  const o = raw as Record<string, unknown>;

  const order: ProfileSection[] = [];
  if (Array.isArray(o.order)) {
    for (const id of o.order) if (isProfileSection(id) && !order.includes(id)) order.push(id);
  }
  for (const id of PROFILE_SECTIONS) if (!order.includes(id)) order.push(id);

  const hidden: ProfileSection[] = [];
  if (Array.isArray(o.hidden)) {
    for (const id of o.hidden) if (isProfileSection(id) && !hidden.includes(id)) hidden.push(id);
  }
  return { order, hidden: PROFILE_SECTIONS.filter((s) => hidden.includes(s)) };
}

export function isDefaultProfileLayout(layout: ProfileLayout): boolean {
  return (
    layout.hidden.length === 0 &&
    layout.order.length === PROFILE_SECTIONS.length &&
    layout.order.every((id, i) => id === PROFILE_SECTIONS[i])
  );
}

export function isSectionHidden(layout: ProfileLayout, section: ProfileSection): boolean {
  return layout.hidden.includes(section);
}

// ─── 文本字段 ────────────────────────────────────────────────────────────

export const HEADLINE_MAX = 60;
export const ABOUT_MAX = 4_000;
export const MAX_INTERESTS = 12;
export const INTEREST_MAX = 20;
export const MAX_LINKS = 6;
export const LINK_LABEL_MAX = 24;
export const LINK_URL_MAX = 300;

/** Code-point-safe truncation (never splits a surrogate pair / CJK extension char). */
export function sliceCodePoints(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

// C0 controls + DEL. Single-line fields drop all of them (a tab/CR/LF in a
// headline is never intended and breaks one-line layouts); multi-line fields
// keep \n and \t.
const CONTROL_ALL_RE = /[\u0000-\u001f\u007f]/g;
const CONTROL_KEEP_NEWLINES_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One-line text: controls removed, whitespace collapsed, trimmed, capped. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return sliceCodePoints(v.replace(CONTROL_ALL_RE, ' ').replace(/\s+/g, ' ').trim(), max);
}

export function sanitizeHeadline(v: unknown): string {
  return cleanLine(v, HEADLINE_MAX);
}

/** Markdown body: CRLF normalised, non-newline controls removed, trimmed, capped. */
export function sanitizeAbout(v: unknown): string {
  if (typeof v !== 'string') return '';
  return sliceCodePoints(
    v.replace(/\r\n?/g, '\n').replace(CONTROL_KEEP_NEWLINES_RE, '').trim(),
    ABOUT_MAX,
  );
}

/** 兴趣标签: trimmed, a leading `#` dropped, deduped case-insensitively, capped in count and length. */
export function sanitizeInterests(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const tag = cleanLine(typeof item === 'string' ? item.replace(/^#+/, '') : '', INTEREST_MAX);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_INTERESTS) break;
  }
  return out;
}

export interface ProfileLink {
  label: string;
  url: string;
}

/**
 * A link is kept only when it is a real absolute http(s) URL with no
 * credentials, no whitespace and nothing that could break out of an attribute.
 * `javascript:` / `data:` / protocol-relative `//host` are all rejected — the
 * value is rendered as an `href` on a public page.
 */
export function sanitizeProfileLink(raw: unknown): ProfileLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const url = typeof o.url === 'string' ? o.url.trim() : '';
  if (!url || url.length > LINK_URL_MAX) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (/[\s"'<>`\\\u0000-\u001f\u007f]/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password || !parsed.hostname) return null;
  const label = cleanLine(o.label, LINK_LABEL_MAX) || sliceCodePoints(parsed.hostname, LINK_LABEL_MAX);
  return { label, url };
}

export function sanitizeProfileLinks(raw: unknown): ProfileLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfileLink[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const link = sanitizeProfileLink(item);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}

/** Host shown next to a link label (`github.com`), `''` for anything unparsable. */
export function linkHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// ─── 精选置顶 ────────────────────────────────────────────────────────────

/** What can be pinned. Each kind is re-gated per viewer at render by its own domain helper. */
export const PIN_KINDS = ['skill', 'doc', 'post', 'topic', 'short', 'video', 'event', 'zonePost', 'vote'] as const;
export type PinKind = (typeof PIN_KINDS)[number];
export const MAX_PINS = 6;

const PIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export interface ProfilePin {
  kind: PinKind;
  id: string;
}

export function isPinKind(v: unknown): v is PinKind {
  return typeof v === 'string' && (PIN_KINDS as readonly string[]).includes(v);
}

export function sanitizePin(raw: unknown): ProfilePin | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!isPinKind(o.kind) || typeof o.id !== 'string' || !PIN_ID_RE.test(o.id)) return null;
  return { kind: o.kind, id: o.id };
}

export function pinKey(pin: ProfilePin): string {
  return `${pin.kind}:${pin.id}`;
}

export function sanitizePins(raw: unknown): ProfilePin[] {
  if (!Array.isArray(raw)) return [];
  const out: ProfilePin[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const pin = sanitizePin(item);
    if (!pin || seen.has(pinKey(pin))) continue;
    seen.add(pinKey(pin));
    out.push(pin);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

/**
 * Pin or unpin. Pinning an already-pinned item is a no-op (idempotent retry);
 * pinning past MAX_PINS is refused rather than evicting the oldest silently.
 */
export function togglePin(
  current: readonly ProfilePin[],
  pin: ProfilePin,
  pinned: boolean,
): { pins: ProfilePin[]; error: 'pins_full' | null } {
  const pins = sanitizePins(current);
  const key = pinKey(pin);
  const has = pins.some((p) => pinKey(p) === key);
  if (!pinned) return { pins: pins.filter((p) => pinKey(p) !== key), error: null };
  if (has) return { pins, error: null };
  if (pins.length >= MAX_PINS) return { pins, error: 'pins_full' };
  return { pins: [...pins, pin], error: null };
}

// ─── 名片 ────────────────────────────────────────────────────────────────

/**
 * holo       — 全息卡：React Bits <ProfileCard/> — tilt, holographic shine, glass user bar.
 * reflective — 镜面卡：React Bits <ReflectiveCard/> — the member's photo/video behind
 *              frosted metal, ID-card layout.
 * minimal    — 简约卡：surface card that follows the site theme.
 */
export const CARD_STYLES = ['holo', 'reflective', 'minimal'] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

/** The luminance mask the holo shine is cut through. */
export const CARD_PATTERNS = ['grid', 'dots', 'waves', 'none'] as const;
export type CardPattern = (typeof CARD_PATTERNS)[number];

/** blend = media takes the card's tint (luminosity blend, React Bits default); natural = the photo's own colours. */
export const CARD_MEDIA_TONES = ['blend', 'natural'] as const;
export type CardMediaTone = (typeof CARD_MEDIA_TONES)[number];

export const CARD_STATUS_MAX = 32;
export const CARD_LABEL_MAX = 24;
export const CARD_BLUR_MAX = 24;

export interface CardConfig {
  style: CardStyle;
  /** `#rrggbb`, or null ⇒ the member's name-hashed identity colour. */
  theme: string | null;
  /** 状态一句话 — holo glass bar / reflective header. */
  status: string;
  /** 名片角标 — reflective header chip (e.g. "CARI · MEMBER"). '' ⇒ i18n default. */
  label: string;
  pattern: CardPattern;
  mediaTone: CardMediaTone;
  /** CSS object-position `'x% y%'`, or '' for centre. */
  mediaPos: string;
  /** reflective: backdrop blur in px (0–CARD_BLUR_MAX). */
  blur: number;
  /** reflective: grayscale 0–100 (%). */
  grayscale: number;
  showDept: boolean;
  showBadges: boolean;
  showStats: boolean;
  /** Pointer tilt + shine follow (always off for reduced motion / touch regardless). */
  tilt: boolean;
}

export const DEFAULT_CARD_CONFIG: Readonly<CardConfig> = Object.freeze({
  style: 'holo',
  theme: null,
  status: '',
  label: '',
  pattern: 'grid',
  mediaTone: 'blend',
  mediaPos: '',
  blur: 12,
  grayscale: 15,
  showDept: true,
  showBadges: true,
  showStats: true,
  tilt: true,
});

const HEX_RE = /^#?([0-9a-f]{6})$/i;

/** `#RRGGBB` / `rrggbb` → `#rrggbb`; anything else → null. Never raw CSS. */
export function normalizeHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = HEX_RE.exec(v.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

const POS_RE = /^(\d{1,3})% (\d{1,3})%$/;

/** `'x% y%'` with both in 0–100, else '' (centre). */
export function parseMediaPos(v: unknown): string {
  if (typeof v !== 'string') return '';
  const m = POS_RE.exec(v.trim());
  if (!m) return '';
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (x > 100 || y > 100) return '';
  return `${x}% ${y}%`;
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function parseCardConfig(raw: unknown): CardConfig {
  const d = DEFAULT_CARD_CONFIG;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...d };
  const o = raw as Record<string, unknown>;
  return {
    style: pick(o.style, CARD_STYLES, d.style),
    theme: normalizeHexColor(o.theme),
    status: cleanLine(o.status, CARD_STATUS_MAX),
    label: cleanLine(o.label, CARD_LABEL_MAX),
    pattern: pick(o.pattern, CARD_PATTERNS, d.pattern),
    mediaTone: pick(o.mediaTone, CARD_MEDIA_TONES, d.mediaTone),
    mediaPos: parseMediaPos(o.mediaPos),
    blur: intIn(o.blur, 0, CARD_BLUR_MAX, d.blur),
    grayscale: intIn(o.grayscale, 0, 100, d.grayscale),
    showDept: bool(o.showDept, d.showDept),
    showBadges: bool(o.showBadges, d.showBadges),
    showStats: bool(o.showStats, d.showStats),
    tilt: bool(o.tilt, d.tilt),
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const rgba = ([r, g, b]: [number, number, number], a: number) => `rgba(${r}, ${g}, ${b}, ${a})`;

export interface CardPalette {
  /** The resolved theme colour, `#rrggbb`. */
  base: string;
  /** Glow behind the card (React Bits `--behind-glow-color`). */
  glow: string;
  /** Holo inner gradient (React Bits `--inner-gradient`): theme → a 40° neighbour, both translucent. */
  innerGradient: string;
  /** Reflective overlay tint. */
  overlay: string;
  /** Solid-ish gradient used when a card has no media at all. */
  emptyGradient: string;
}

/**
 * Derive every colour a card paints from ONE validated hex. Output is only
 * ever `rgba(…)` / `linear-gradient(…)` built from numbers — no stored string
 * reaches CSS.
 */
export function cardPalette(theme: string): CardPalette {
  const base = normalizeHexColor(theme) ?? '#5c5ba6';
  const rgb = hexToRgb(base);
  const [h, s, l] = rgbToHsl(...rgb);
  const neighbour = hslToRgb(h + 40, Math.min(1, s + 0.1), Math.min(0.72, l + 0.18));
  const deep = hslToRgb(h, Math.min(1, s), Math.max(0.1, l * 0.45));
  return {
    base,
    glow: rgba(hslToRgb(h, s, Math.min(0.7, l + 0.15)), 0.67),
    innerGradient: `linear-gradient(145deg, ${rgba(rgb, 0.55)} 0%, ${rgba(neighbour, 0.27)} 100%)`,
    overlay: rgba(rgb, 0.12),
    emptyGradient: `linear-gradient(160deg, ${rgba(rgb, 0.95)} 0%, ${rgba(deep, 1)} 100%)`,
  };
}

// ─── 名片媒体 ────────────────────────────────────────────────────────────

/**
 * Stored under `<uploads root>/profile-card/<key>` so the existing `/_uploads/`
 * nginx handoff (MEDIA_X_ACCEL_REDIRECT) covers it with no ops change.
 *   image  — card photo (metadata stripped)   poster — first frame of a card video
 *   video  — the uploaded original, NEVER served   loop — server-generated ≤ PROFILE_LOOP_SECONDS muted clip
 * A key's id is `<ownerTag>-<nanoid>` for uploads since the owner binding
 * (lib/profile/card-media-storage.ts); older untagged keys still match the shape.
 */
export const PROFILE_MEDIA_KINDS = ['image', 'video', 'poster', 'loop'] as const;
export type ProfileMediaKind = (typeof PROFILE_MEDIA_KINDS)[number];

export const PROFILE_IMAGE_EXTS = ['jpg', 'png', 'webp', 'avif', 'gif'] as const;
export const PROFILE_VIDEO_EXTS = ['mp4', 'webm', 'mov'] as const;

export const PROFILE_MEDIA_KEY_RE =
  /^(image|video|poster|loop)\/[A-Za-z0-9_-]{8,40}\.(jpg|png|webp|avif|gif|mp4|webm|mov)$/;

export function isValidProfileMediaKey(key: unknown, kind?: ProfileMediaKind): key is string {
  if (typeof key !== 'string') return false;
  const m = PROFILE_MEDIA_KEY_RE.exec(key);
  if (!m) return false;
  const [, k, ext] = m;
  if (kind && k !== kind) return false;
  const isImageExt = (PROFILE_IMAGE_EXTS as readonly string[]).includes(ext);
  if (k === 'image' || k === 'poster') return isImageExt;
  if (k === 'loop') return ext === 'mp4';
  return !isImageExt; // video
}

/** Root-relative public URL for a validated key (apply withBasePath at render). */
export function profileMediaUrl(key: string): string {
  return `/api/profile/media/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export const PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const PROFILE_POSTER_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_VIDEO_MAX_BYTES = 60 * 1024 * 1024;
/**
 * Length of the generated hover loop — the ONLY moving picture a card plays.
 * Without a loop a card video is poster-only; the original is never played.
 */
export const PROFILE_LOOP_SECONDS = 8;

// ─── 徽章 ────────────────────────────────────────────────────────────────

/** Icon keys an admin may give a UserTag. The client maps each to a lucide icon. */
export const BADGE_ICONS = [
  'award',
  'badge-check',
  'star',
  'crown',
  'shield',
  'flame',
  'sparkles',
  'trophy',
  'medal',
  'gem',
  'rocket',
  'book',
  'code',
  'mic',
  'heart',
  'zap',
  'target',
  'lightbulb',
  'graduation',
  'users',
] as const;
export type BadgeIcon = (typeof BADGE_ICONS)[number];

export function isBadgeIcon(v: unknown): v is BadgeIcon {
  return typeof v === 'string' && (BADGE_ICONS as readonly string[]).includes(v);
}
