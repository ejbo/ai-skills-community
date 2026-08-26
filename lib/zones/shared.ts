// 技术专区 — pure, import-free helpers shared by server and client (unit-tested
// in tests/zones-shared.test.ts). No env, no prisma, no next-intl here.

import { POLL_TOKEN_GLOBAL_RE } from '@/lib/polls-shared';

// ── Slugs ────────────────────────────────────────────────────────────────────

/** 3–40 chars, lowercase ascii + digits + single dashes, never leading/trailing dash. */
export const ZONE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const ZONE_SLUG_MIN = 3;
export const ZONE_SLUG_MAX = 40;

/** Reserved first segments under /zones/ that can never be a zone slug. */
export const RESERVED_ZONE_SLUGS: ReadonlySet<string> = new Set(['new', 'mine', 'api', 'manage', 'admin', 'search', 'embed']);

export function isValidZoneSlug(slug: string): boolean {
  return ZONE_SLUG_RE.test(slug) && !RESERVED_ZONE_SLUGS.has(slug);
}

/**
 * Best-effort ascii slug from a (possibly CJK) name; returns '' when nothing
 * ascii survives so the caller can fall back to a random/handle-based slug.
 */
export function slugifyAscii(input: string, max = ZONE_SLUG_MAX): string {
  const s = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return s.slice(0, max).replace(/-+$/g, '');
}

/** Wiki page slugs: same alphabet, 1–60 chars (single-char pages like "faq" are fine). */
export const WIKI_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
export const RESERVED_WIKI_SLUGS: ReadonlySet<string> = new Set(['new', 'edit', 'history']);

export function isValidWikiSlug(slug: string): boolean {
  return WIKI_SLUG_RE.test(slug) && !RESERVED_WIKI_SLUGS.has(slug);
}

// ── Enumerations (DB values; display through `labels.zone*` i18n keys) ───────

export const ZONE_POST_TYPES = ['article', 'report', 'paper', 'slides', 'link', 'announcement'] as const;
export type ZonePostTypeValue = (typeof ZONE_POST_TYPES)[number];
export function isZonePostType(v: unknown): v is ZonePostTypeValue {
  return typeof v === 'string' && (ZONE_POST_TYPES as readonly string[]).includes(v);
}
/** Types a plain `post` holder may choose; `announcement` needs `moderate`. */
export const ZONE_POST_TYPES_FOR_AUTHORS: readonly ZonePostTypeValue[] = ['article', 'report', 'paper', 'slides', 'link'];

export const ZONE_VISIBILITIES = ['public', 'members'] as const;
export const ZONE_JOIN_POLICIES = ['open', 'approval', 'invite'] as const;

export const ZONE_POST_SORTS = ['new', 'hot'] as const;
export type ZonePostSort = (typeof ZONE_POST_SORTS)[number];
export function parseZonePostSort(v: unknown): ZonePostSort {
  return v === 'hot' ? 'hot' : 'new';
}

export const ZONE_FEED_SORTS = ['new', 'hot'] as const;
export type ZoneFeedSort = (typeof ZONE_FEED_SORTS)[number];
export function parseZoneFeedSort(v: unknown): ZoneFeedSort {
  return v === 'hot' ? 'hot' : 'new';
}

export const ZONE_SORTS = ['active', 'new', 'members'] as const;
export type ZoneSort = (typeof ZONE_SORTS)[number];
export function parseZoneSort(v: unknown): ZoneSort {
  return v === 'new' || v === 'members' ? v : 'active';
}

// ── External links on a zone ─────────────────────────────────────────────────

export interface ZoneLink {
  label: string;
  url: string;
}
export const MAX_ZONE_LINKS = 8;

/** Validates the Json column / a form payload into a clean list (drops bad rows). */
export function parseZoneLinks(v: unknown): ZoneLink[] {
  if (!Array.isArray(v)) return [];
  const out: ZoneLink[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const url = normalizeHttpUrl((item as { url?: unknown }).url);
    if (!url) continue;
    const rawLabel = (item as { label?: unknown }).label;
    const label = (typeof rawLabel === 'string' ? rawLabel : '').trim().slice(0, 40) || hostnameOf(url);
    out.push({ label, url });
    if (out.length >= MAX_ZONE_LINKS) break;
  }
  return out;
}

/** http(s) only, trimmed, `URL`-normalized; null otherwise. */
export function normalizeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ── Tags ─────────────────────────────────────────────────────────────────────

export const MAX_ZONE_POST_TAGS = 8;
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_ZONE_POST_TAGS) break;
  }
  return out;
}

// ── 栏目 (ZoneColumn) ────────────────────────────────────────────────────────
//
// Zone-scoped content taxonomy, ORTHOGONAL to ZonePostType (which is the content
// FORMAT: 文章/研究报告/论文/…). 版主 curates `official` columns in 版块设置 → 栏目;
// members may create their own from the composer when `allowMemberColumns`.

export const COLUMN_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
export const MAX_ZONE_COLUMNS = 60;

export function isValidColumnSlug(slug: string): boolean {
  return COLUMN_SLUG_RE.test(slug);
}

/** Column slug from a (possibly CJK) name; '' when nothing ascii survives — caller falls back. */
export function columnSlugFrom(name: string): string {
  return slugifyAscii(name, 40);
}

/** Display-normalized column name (collapse whitespace, cap length). */
export function normalizeColumnName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, ZONE_LIMITS.columnNameMax);
}

/** Case/space-insensitive key so "大模型 推理" and "大模型推理" don't both exist. */
export function columnDedupeKey(name: string): string {
  return normalizeColumnName(name).toLowerCase().replace(/\s+/g, '');
}

// ── 帖子可见性 ───────────────────────────────────────────────────────────────
//
// NARROWS within the zone, never widens it: a post in a `members` zone is never
// visible to non-members whatever this says.

export const ZONE_POST_VISIBILITIES = ['zone', 'members', 'restricted'] as const;
export type ZonePostVisibilityValue = (typeof ZONE_POST_VISIBILITIES)[number];
export function isZonePostVisibility(v: unknown): v is ZonePostVisibilityValue {
  return typeof v === 'string' && (ZONE_POST_VISIBILITIES as readonly string[]).includes(v);
}

/** Share code for `restricted` posts: 6 chars, no look-alikes (0/O/1/I/l). */
export const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ACCESS_CODE_LENGTH = 6;
export const ACCESS_CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

/** Uppercase + strip separators so "abc-123" and "ABC123" are the same code. */
export function normalizeAccessCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidAccessCode(raw: string): boolean {
  return ACCESS_CODE_RE.test(normalizeAccessCode(raw));
}

// ── 组织筛选 (研究所 → 部门) ─────────────────────────────────────────────────
//
// The hub filters zones/posts by 研究所 (top level) → 部门 (its children), both
// MULTI-select. Values are the free-text Zone.lab / Zone.department strings, so
// the tree is derived from live rows (lib/zones/queries.ts#zoneOrgTree).

export interface OrgDeptNode {
  department: string;
  zoneCount: number;
}
export interface OrgLabNode {
  lab: string;
  zoneCount: number;
  departments: OrgDeptNode[];
}

/** searchParams `?lab=a,b` → clean list (deduped, capped, empties dropped). */
export function parseMultiParam(raw: string | null | undefined, max = 20): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const v = part.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export function serializeMultiParam(values: readonly string[]): string {
  return values.filter(Boolean).join(',');
}

// ── Attachments ──────────────────────────────────────────────────────────────

export const ZONE_ATTACHMENT_LIMITS = { images: 12, videos: 2, files: 8 } as const;
export const MAX_ZONE_ATTACHMENTS = ZONE_ATTACHMENT_LIMITS.images + ZONE_ATTACHMENT_LIMITS.videos + ZONE_ATTACHMENT_LIMITS.files;

export const MAX_ZONE_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_ZONE_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const MAX_ZONE_FILE_BYTES = 200 * 1024 * 1024; // 200 MB
export const MAX_ZONE_COVER_BYTES = 20 * 1024 * 1024; // 20 MB

/** Storage key shape for every zone media kind (lib/zones/storage.ts writes them). */
export const ZONE_MEDIA_KEY_RE = /^(image|video|file|cover|icon|poster|preview)\/[A-Za-z0-9_-]+\.[a-z0-9]{2,5}$/;

export const ZONE_FILE_EXT: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
};
export const ZONE_FILE_EXTS: ReadonlySet<string> = new Set(Object.values(ZONE_FILE_EXT));
export const ZONE_FILE_ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx,.xls,.xlsx,.zip,.txt,.md,.csv,.json';
export const ZONE_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']);
export const ZONE_VIDEO_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/** Office formats we try to turn into a PDF preview (LibreOffice) — slides also get the HTML fallback. */
export const OFFICE_PREVIEW_EXTS: ReadonlySet<string> = new Set(['ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx']);
export const SLIDE_EXTS: ReadonlySet<string> = new Set(['ppt', 'pptx']);

export function extOfName(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

export function isOfficePreviewable(nameOrExt: string): boolean {
  const ext = nameOrExt.includes('.') ? extOfName(nameOrExt) : nameOrExt.toLowerCase();
  return OFFICE_PREVIEW_EXTS.has(ext);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

// ── Native embed tokens `[embed:<kind>:<ref>]` ───────────────────────────────
//
// Own-line tokens, fence-aware (same contract as lib/polls-shared.ts). Refs:
//   library:<doc slug>   short:<video id>   video:<video slug>   skill:<slug>
//   pack:<slug>          event:<event id>   post:<zone post id>  file:<attachment id>
//   link:<http(s) url>
// tiptap-markdown escapes the brackets on serialize (`\[embed:…\]`), so both
// forms match. Rendering: components/zones/ZoneMarkdown.tsx splits and mounts an
// EmbedCard per token; the server resolves every token in one pass
// (lib/zones/embeds.ts) with the source domain's own visibility gate.

export const EMBED_KINDS = ['library', 'short', 'video', 'skill', 'pack', 'event', 'post', 'file', 'link'] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];
export function isEmbedKind(v: unknown): v is EmbedKind {
  return typeof v === 'string' && (EMBED_KINDS as readonly string[]).includes(v);
}

const KIND_ALT = EMBED_KINDS.join('|');
/** Whole line: ≤3 leading spaces, optional `\` escapes, trailing whitespace only. */
export const EMBED_TOKEN_RE = new RegExp(`^ {0,3}\\\\?\\[embed:(${KIND_ALT}):([^\\n\\]]{1,512}?)\\\\?\\][ \\t]*$`);
/** Global strip/excerpt sibling (both escaped and plain forms). */
export const EMBED_TOKEN_GLOBAL_RE = new RegExp(`\\\\?\\[embed:(?:${KIND_ALT}):[^\\n\\]]{1,512}?\\\\?\\]`, 'g');
export const EMBED_REF_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const MAX_EMBEDS_PER_CONTENT = 20;

export interface EmbedRef {
  kind: EmbedKind;
  ref: string;
}

export function embedToken(kind: EmbedKind, ref: string): string {
  return `[embed:${kind}:${ref}]`;
}

export function embedKey(kind: EmbedKind, ref: string): string {
  return `${kind}:${ref}`;
}

/** Validates the ref for its kind; returns the normalized ref or null. */
export function normalizeEmbedRef(kind: EmbedKind, raw: string): string | null {
  const ref = raw.trim();
  if (kind === 'link') return normalizeHttpUrl(ref);
  return EMBED_REF_RE.test(ref) ? ref : null;
}

/** Parses one LINE; null unless it is exactly an own-line token with a valid ref. */
export function parseEmbedToken(line: string): EmbedRef | null {
  const m = EMBED_TOKEN_RE.exec(line);
  if (!m) return null;
  const kind = m[1] as EmbedKind;
  const ref = normalizeEmbedRef(kind, m[2]);
  return ref ? { kind, ref } : null;
}

export type EmbedSegment = { type: 'md'; text: string } | { type: 'embed'; kind: EmbedKind; ref: string; key: string };

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Splits markdown into md / embed segments. A token inside a ``` / ~~~ fence
 * stays inert text; a 4-space-indented token is a code block (not matched by
 * the ≤3-space rule); duplicates render once; past MAX_EMBEDS the rest stay text.
 */
export function splitEmbedSegments(content: string): EmbedSegment[] {
  if (!content.includes('[embed:')) return [{ type: 'md', text: content }];
  const lines = content.split('\n');
  const segments: EmbedSegment[] = [];
  const seen = new Set<string>();
  let buf: string[] = [];
  let fence: { char: string; len: number } | null = null;
  const flush = () => {
    const text = buf.join('\n');
    if (text.trim() !== '') segments.push({ type: 'md', text });
    buf = [];
  };
  for (const line of lines) {
    const fenceMark = FENCE_RE.exec(line);
    if (fenceMark) {
      const char = fenceMark[1][0];
      const len = fenceMark[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      buf.push(line);
      continue;
    }
    if (fence) {
      buf.push(line);
      continue;
    }
    const parsed = parseEmbedToken(line);
    if (parsed) {
      const key = embedKey(parsed.kind, parsed.ref);
      if (!seen.has(key) && seen.size < MAX_EMBEDS_PER_CONTENT) {
        seen.add(key);
        flush();
        segments.push({ type: 'embed', kind: parsed.kind, ref: parsed.ref, key });
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return segments.length > 0 ? segments : [{ type: 'md', text: content }];
}

/** Distinct embed refs in render order (what the server must resolve). */
export function collectEmbedRefs(content: string): EmbedRef[] {
  return splitEmbedSegments(content)
    .filter((s): s is Extract<EmbedSegment, { type: 'embed' }> => s.type === 'embed')
    .map((s) => ({ kind: s.kind, ref: s.ref }));
}

// ── Excerpts ─────────────────────────────────────────────────────────────────

/** Plain-text excerpt of a markdown body (code-point safe, strips tokens/images/md noise). */
export function excerptOf(md: string, max = 160): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(EMBED_TOKEN_GLOBAL_RE, ' ')
    .replace(POLL_TOKEN_GLOBAL_RE, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_~`|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cps = [...text];
  return cps.length > max ? `${cps.slice(0, max).join('')}…` : text;
}

/** Rough reading time from a markdown body (CJK counts per char, latin per word). */
export function estimateReadMinutes(md: string): number {
  const text = md.replace(/```[\s\S]*?```/g, ' ');
  const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
  const cjk = (text.match(CJK) ?? []).length;
  const words = (text.replace(CJK, ' ').match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 220));
}

// ── Headings (post TOC rail) ─────────────────────────────────────────────────

export interface MdHeading {
  level: number;
  text: string;
  id: string;
}

/** Fence-aware `#` heading scan; ids match rehype-slug-style slugs for the same text. */
export function extractHeadings(md: string, maxLevel = 3): MdHeading[] {
  const out: MdHeading[] = [];
  const counts = new Map<string, number>();
  let fence: { char: string; len: number } | null = null;
  for (const line of md.split('\n')) {
    const fenceMark = FENCE_RE.exec(line);
    if (fenceMark) {
      const char = fenceMark[1][0];
      const len = fenceMark[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      continue;
    }
    if (fence) continue;
    const m = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    if (level > maxLevel) continue;
    const text = m[2].replace(/[*_`~]/g, '').trim();
    if (!text) continue;
    const base = headingSlug(text);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    out.push({ level, text, id: n === 0 ? base : `${base}-${n}` });
  }
  return out;
}

/** github-slugger-compatible enough for our own headings (lowercase, strip punctuation, spaces→dashes). */
export function headingSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  );
}

// ── Cursors (keyset `time|id`) ───────────────────────────────────────────────

export function encodeTimeCursor(row: { at: Date | string; id: string }): string {
  const d = typeof row.at === 'string' ? new Date(row.at) : row.at;
  return `${d.toISOString()}|${row.id}`;
}

export function decodeTimeCursor(raw: string | null | undefined): { at: Date; id: string } | null {
  if (!raw) return null;
  const sep = raw.indexOf('|');
  if (sep <= 0) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

export function decodeOffsetCursor(raw: string | null | undefined): number {
  if (!raw || !raw.startsWith('o:')) return 0;
  const n = Number(raw.slice(2));
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

// ── Hrefs ────────────────────────────────────────────────────────────────────

export function zoneHref(slug: string): string {
  return `/zones/${slug}`;
}
export function zonePostHref(slug: string, postId: string): string {
  return `/zones/${slug}/posts/${postId}`;
}
export function zoneWikiHref(slug: string, pageSlug?: string | null): string {
  return pageSlug ? `/zones/${slug}/wiki/${pageSlug}` : `/zones/${slug}/wiki`;
}

// ── Limits shared by API + UI ────────────────────────────────────────────────

export const ZONE_LIMITS = {
  nameMin: 2,
  nameMax: 40,
  taglineMax: 80,
  descriptionMax: 20_000,
  labMax: 64,
  departmentMax: 64,
  memberTitleMax: 32,
  joinMessageMax: 300,
  roleNameMax: 24,
  roleDescriptionMax: 120,
  postTitleMin: 2,
  postTitleMax: 120,
  postSummaryMax: 300,
  postBodyMax: 200_000,
  commentMax: 3_000,
  wikiTitleMax: 80,
  wikiBodyMax: 200_000,
  wikiNoteMax: 120,
  maxCoauthors: 12,
  maxPinnedPosts: 5,
  maxCustomRoles: 12,
  columnNameMax: 24,
  columnDescriptionMax: 120,
} as const;
