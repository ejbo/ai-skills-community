// 富文本 → 纯文本 / 可见长度 — THE one place a stored markdown body is turned
// into plain text or measured.
//
// Import-free except two token contracts (lib/rich-marks.ts, lib/polls-shared.ts)
// and client-safe, because both sides need the same answer: the server builds
// excerpts / notification snippets / TOC labels and enforces length caps, the
// client shows the counter and the tooLong gate for the SAME body. It must never
// import lib/zones/shared.ts — that module imports THIS one (excerptOf,
// extractHeadings), so the embed token is matched by a generic superset below.
//
// Why a real (small) scanner instead of the regex chains every surface used to
// carry: stored bodies contain inline HTML now — the editor's formatting spans
// (`<span data-color="red">…</span>`, lib/rich-marks.ts), resized images
// (`<img … width>`) and raw-HTML tables — and the old chains each got a
// different part wrong: raw tags leaked into topic rows, the bell and emails;
// `/<[^>]+>/` deleted real prose like `a < b and c > d`; typed `<` showed as
// `&lt;` (tiptap-markdown stores it as an entity); `-`/`#`/`>` were deleted
// mid-word, so `2026-09-14` became `2026 09 14`. Every rule below is decided
// ONCE here:
//
//  • Fenced code blocks are DROPPED from a body that has prose (no marker): a
//    preview of prose that dumps a code listing reads as noise and can be huge,
//    and a marker would be a UI string — this module takes no i18n. A body with
//    NOTHING but code falls back to its first non-blank code line instead, so a
//    code-only 动态 / reply still has a readable title, bell line and email
//    snippet. (The old helpers disagreed here: the zone/discussion excerpts
//    dropped fences, but search's mdExcerpt, the notification truncate and the
//    admin excerpt showed the code — an empty result would be a loss for those.)
//    Callers keep their own fallback for a body with no text at all (images,
//    embeds only): 「动态」, 「（无文字，仅媒体）」.
//  • Ordered-list numbers are text (`1. 算子融合；2. 权重量化` keeps its 1. and
//    2.; a line that merely starts with `2026. ` keeps its year); only bullet
//    markers (`-`, `+`, `*`) are syntax. The rendered `<ol>` shows the numbers,
//    so a one-line excerpt that drops them reads worse, not cleaner.
//  • Inline code KEEPS its text, literally: no emphasis stripping, no tag
//    stripping and no entity decoding inside it (CommonMark renders it verbatim,
//    and tiptap-markdown does not escape code-marked text).
//  • Only REAL tags are stripped: `<` + ASCII letter + name, optional attributes,
//    `>`. Prose like `a < b > c` survives. Block-level tags become a space so
//    `</td><td>` never welds two cells into one word; inline tags (our spans)
//    vanish without a space so `Ra<span data-color="red">G</span>` stays `RaG`.
//  • Entities are decoded ONCE, AFTER tags are stripped — so an escaped
//    `&lt;span&gt;` a user typed comes out as the text `<span>`, never as a tag.
//  • Emphasis markers go only where they can be markers: intraword `_`
//    (`snake_case`) and a spaced `*` (`2 * 3`) stay; a single `~` stays (`3~5 天`
//    is common Chinese prose), `~~` goes.
//  • Truncation is by CODE POINT (a cut surrogate pair renders as '�').

import { POLL_TOKEN_GLOBAL_RE } from '@/lib/polls-shared';
import { RICH_SPAN_TAG_RE } from '@/lib/rich-marks';

// ── Code regions (fenced blocks + inline code spans) ─────────────────────────

interface CodeRegion {
  start: number;
  end: number;
  kind: 'fence' | 'code';
  /** Fences only: false when the fence never closes and runs to the end of the document. */
  closed?: boolean;
}

/** CommonMark fence line: ≤3 spaces, ≥3 backticks or tildes, then the info string. */
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

function fenceRegions(src: string): CodeRegion[] {
  const out: CodeRegion[] = [];
  let open: { char: string; len: number; start: number } | null = null;
  let pos = 0;
  for (;;) {
    const nl = src.indexOf('\n', pos);
    const end = nl === -1 ? src.length : nl;
    const m = FENCE_LINE_RE.exec(src.slice(pos, end));
    if (open) {
      // A closing fence: same character, at least as long, nothing after it.
      if (m && m[1][0] === open.char && m[1].length >= open.len && m[2].trim() === '') {
        out.push({ start: open.start, end, kind: 'fence', closed: true });
        open = null;
      }
    } else if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
      // (a backtick info string may not contain a backtick — ```a``` is inline code)
      open = { char: m[1][0], len: m[1].length, start: pos };
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  // An unclosed fence runs to the end of the document (CommonMark).
  if (open) out.push({ start: open.start, end: src.length, kind: 'fence', closed: false });
  return out;
}

/**
 * Inline code spans inside [from, to). Linear: every backtick run is collected
 * once, and each opener looks up the NEXT run of the same length through a
 * per-length cursor that only moves forward — a body of mismatched runs cannot
 * make this quadratic. A span may not cross a blank line (paragraph boundary).
 * A run preceded by an odd number of backslashes loses its first backtick as an
 * OPENER (escaped) but still closes in full (backslashes are literal in code).
 */
function codeSpanRegions(src: string, from: number, to: number, out: CodeRegion[]): void {
  const firstTick = src.indexOf('`', from);
  if (firstTick === -1 || firstTick >= to) return;
  const runs: { pos: number; len: number; escaped: boolean }[] = [];
  const byLen = new Map<number, number[]>();
  for (let i = from; i < to; ) {
    if (src.charCodeAt(i) !== 96) {
      i++;
      continue;
    }
    let j = i;
    while (j < to && src.charCodeAt(j) === 96) j++;
    let slashes = 0;
    for (let k = i - 1; k >= from && src.charCodeAt(k) === 92; k--) slashes++;
    const idx = runs.push({ pos: i, len: j - i, escaped: slashes % 2 === 1 }) - 1;
    const list = byLen.get(j - i);
    if (list) list.push(idx);
    else byLen.set(j - i, [idx]);
    i = j;
  }
  if (runs.length < 2) return;

  const breaks: number[] = [];
  for (const m of src.slice(from, to).matchAll(/\n[ \t]*\n/g)) breaks.push(from + (m.index ?? 0));
  const crossesBreak = (a: number, b: number) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (breaks[mid] < a) lo = mid + 1;
      else hi = mid;
    }
    return lo < breaks.length && breaks[lo] < b;
  };

  const cursor = new Map<number, number>();
  let i = 0;
  while (i < runs.length) {
    const r = runs[i];
    const openLen = r.escaped ? r.len - 1 : r.len;
    const openPos = r.escaped ? r.pos + 1 : r.pos;
    let matched = -1;
    const list = openLen > 0 ? byLen.get(openLen) : undefined;
    if (list) {
      let p = cursor.get(openLen) ?? 0;
      while (p < list.length && list[p] <= i) p++;
      cursor.set(openLen, p);
      if (p < list.length && !crossesBreak(openPos + openLen, runs[list[p]].pos)) matched = list[p];
    }
    if (matched === -1) {
      i++;
      continue;
    }
    const close = runs[matched];
    out.push({ start: openPos, end: close.pos + close.len, kind: 'code' });
    i = matched + 1;
  }
}

/**
 * Sorted, non-overlapping code regions of a markdown body. `fences: false` is
 * for ONE line of inline content (a heading's text), where a leading ``` is
 * literal text, not a block opener.
 */
function codeRegions(src: string, fences = true): CodeRegion[] {
  if (!src.includes('`') && !src.includes('~')) return [];
  const out: CodeRegion[] = [];
  let cursor = 0;
  for (const fence of fences ? fenceRegions(src) : []) {
    codeSpanRegions(src, cursor, fence.start, out);
    out.push(fence);
    cursor = fence.end;
  }
  codeSpanRegions(src, cursor, src.length, out);
  return out;
}

/** The literal text a code span renders (CommonMark: newlines → spaces, one padding space trimmed). */
function codeSpanText(raw: string): string {
  let a = 0;
  while (a < raw.length && raw.charCodeAt(a) === 96) a++;
  let b = raw.length;
  while (b > a && raw.charCodeAt(b - 1) === 96) b--;
  let inner = raw.slice(a, b).replace(/\n/g, ' ');
  if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '') {
    inner = inner.slice(1, -1);
  }
  return inner;
}

// ── Our formatting spans (balanced) ──────────────────────────────────────────

/** A real HTML tag: `<`, an ASCII-letter name, optional attributes, `>`. NOT `a < b > c`. */
const TAG_SOURCE = String.raw`<\/?([A-Za-z][\w-]*)(?:\s[^<>]*)?\/?>`;

/** RICH_SPAN_TAG_RE anchored to a whole tag (built once; the shared regex is global/stateful). */
const RICH_TAG_EXACT = new RegExp(`^(?:${RICH_SPAN_TAG_RE.source})$`, RICH_SPAN_TAG_RE.flags.replace(/[gy]/g, ''));

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/**
 * [start, end) ranges of the formatting markup the editor adds: every opener
 * RICH_SPAN_TAG_RE recognises, plus the closer that closes THAT opener. The scan
 * keeps a stack per tag name, so a `</span>` closing a foreign `<span class>`
 * (a README body, a highlight.js token) is never mistaken for ours, and a stray
 * closer with nothing open is left alone. An unclosed opener of ours still
 * counts as markup (the renderer auto-closes it; it is not visible text). Tags
 * inside code are literal text and never match.
 */
function richTagRanges(md: string): Array<[number, number]> {
  if (!md.includes('<')) return [];
  const regions = codeRegions(md);
  const ranges: Array<[number, number]> = [];
  const stacks = new Map<string, { ours: boolean; start: number; end: number }[]>();
  const unclosed: { ours: boolean; start: number; end: number }[] = [];
  let r = 0;
  for (const m of md.matchAll(new RegExp(TAG_SOURCE, 'g'))) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    while (r < regions.length && regions[r].end <= start) r++;
    if (r < regions.length && regions[r].start < end) continue; // inside code
    const name = m[1].toLowerCase();
    if (m[0].startsWith('</')) {
      const top = stacks.get(name)?.pop();
      if (top?.ours) ranges.push([top.start, top.end], [start, end]);
      continue;
    }
    if (m[0].endsWith('/>') || VOID_TAGS.has(name)) continue;
    const entry = { ours: RICH_TAG_EXACT.test(m[0]), start, end };
    const stack = stacks.get(name);
    if (stack) stack.push(entry);
    else stacks.set(name, [entry]);
    if (entry.ours) unclosed.push(entry);
  }
  // Openers of ours that no closer popped.
  const closedStarts = new Set(ranges.map(([s]) => s));
  for (const e of unclosed) if (!closedStarts.has(e.start)) ranges.push([e.start, e.end]);
  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * Characters of a body that are VISIBLE text as far as length caps go: the raw
 * length minus the formatting spans the editor adds. Colouring a phrase adds
 * ~30 raw characters (`<span data-color="red">` + `</span>`); counting those
 * against a 2000-character comment cap would make a formatted comment fail
 * validation although its text is far shorter. Everything else still counts —
 * links, images and markdown syntax are what the author typed or inserted.
 * UTF-16 units, like the zod `.max()` it replaces.
 */
export function richTextLength(md: string): number {
  let n = md.length;
  for (const [s, e] of richTagRanges(md)) n -= e - s;
  return n;
}

/**
 * The raw-string ceiling that rides along with a visible-length cap: markup is
 * discounted, but not without bound — a body of nothing but nested spans must
 * still be rejected. 4× leaves room for formatting every word of a short
 * comment and keeps the stored row within a few kB of the cap.
 */
export const RICH_TEXT_RAW_CEILING_FACTOR = 4;

/**
 * The one length gate shared by the server (zod, lib/rich-text-limit.ts) and every client tooLong check.
 * Visible length never exceeds raw length, so a body within the limit RAW is answered without a scan —
 * the common case for a 200 000-character post re-checked on every keystroke.
 */
export function isRichTextTooLong(md: string, limit: number): boolean {
  if (md.length <= limit) return false;
  return md.length > limit * RICH_TEXT_RAW_CEILING_FACTOR || richTextLength(md) > limit;
}

/**
 * Remove the editor's formatting spans, keeping their inner text and every
 * other piece of HTML/markdown byte-for-byte (code untouched). For surfaces
 * where formatting is meaningless or harmful but markdown is not: the SKILL.md
 * fallback body installed into other people's agent folders, AI prompt context.
 */
export function stripRichFormatting(md: string): string {
  const ranges = richTagRanges(md);
  if (ranges.length === 0) return md;
  let out = '';
  let cursor = 0;
  for (const [s, e] of ranges) {
    out += md.slice(cursor, s);
    cursor = e;
  }
  return out + md.slice(cursor);
}

/**
 * What a plain `<textarea>` would show as SOURCE if this body were put in one.
 * `formatting`: the editor's own formatting spans (removable with
 * stripRichFormatting). `other`: any other real HTML tag outside code — a
 * resized `<img width>`, a `<br>` in a table cell, a raw-HTML table, the flow
 * serializer's `<strong>` fallback, a foreign `</span>`. Markdown syntax is not
 * counted: the simple comment box is markdown-native. The comment composer
 * (components/video/CommentComposer.tsx) asks this before leaving 富文本, so
 * switching never silently turns a formatted comment into a wall of tags.
 */
export function htmlMarkupIn(md: string): { formatting: boolean; other: boolean } {
  if (!md.includes('<')) return { formatting: false, other: false };
  const ours = richTagRanges(md);
  const oursStarts = new Set(ours.map(([s]) => s));
  const regions = codeRegions(md);
  let other = false;
  let r = 0;
  for (const m of md.matchAll(new RegExp(TAG_SOURCE, 'g'))) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    while (r < regions.length && regions[r].end <= start) r++;
    if (r < regions.length && regions[r].start < end) continue; // inside code: literal text
    if (oursStarts.has(start)) continue;
    other = true;
    break;
  }
  return { formatting: ours.length > 0, other };
}

// ── Plain text ───────────────────────────────────────────────────────────────

/**
 * Own-line 站内引用 token, every kind (`[embed:<kind>:<ref>]`, optionally
 * backslash-escaped). A deliberate SUPERSET of lib/zones/shared.ts's
 * EMBED_TOKEN_GLOBAL_RE (kinds are lowercase words) so this module never imports
 * the zone contract it is imported by; tests/markdown-text.test.ts pins that
 * every real kind is stripped.
 */
const EMBED_TOKEN_ANY_RE = /\\?\[embed:[a-z]+:[^\n\]]{1,512}?\\?\]/g;

/** A backslash escape of ASCII punctuation (CommonMark). */
const ESCAPE_RE = /\\([!-/:-@[-`{-~])/g;

/** Private-use sentinels around a stash index — survive every markdown pass. */
const STASH_RE = /(\d+)/g;

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'div', 'dl', 'dt', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'img', 'li', 'main', 'nav', 'ol', 'p', 'picture',
  'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul', 'video',
]);

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z]{2,6}));/g, (whole, dec, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? whole;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    // CommonMark: 0, surrogates and out-of-range code points become U+FFFD.
    if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
    return String.fromCodePoint(cp);
  });
}

const QUOTE_PREFIX_RE = /^(?:[ \t]{0,3}>[ \t]?)+/;
const HR_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:_[ \t]*){3,}|(?:-[ \t]*){3,})$/;
const SETEXT_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
const TABLE_DELIM_RE = /^[ \t]*\|?(?:[ \t]*:?-+:?[ \t]*\|)+(?:[ \t]*:?-+:?[ \t]*)?$/;
const LINK_DEF_RE = /^ {0,3}\[[^\]\n]+\]:[ \t]*\S/;
/** Bullet markers only — an ordered `1.` / `1)` is kept as text (see the header). */
const LIST_MARKER_RE = /^[ \t]*[-+*][ \t]+/;
const TASK_BOX_RE = /^\[[ xX]\][ \t]+/;
const HEADING_MARKER_RE = /^ {0,3}#{1,6}(?:[ \t]+|$)/;
const HEADING_CLOSE_RE = /[ \t]+#+[ \t]*$/;

function stripBlockSyntax(text: string): string {
  return text
    .split('\n')
    .map((raw) => {
      if (LINK_DEF_RE.test(raw)) return '';
      const line = raw.replace(QUOTE_PREFIX_RE, '');
      if (HR_RE.test(line) || SETEXT_RE.test(line) || TABLE_DELIM_RE.test(line)) return '';
      const item = line.replace(LIST_MARKER_RE, '').replace(TASK_BOX_RE, '');
      return HEADING_MARKER_RE.test(item) ? item.replace(HEADING_MARKER_RE, '').replace(HEADING_CLOSE_RE, '') : item;
    })
    .join('\n');
}

const IMAGE_RE = /!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
const IMAGE_REF_RE = /!\[[^\]\n]*\]\[[^\]\n]*\]/g;
const LINK_RE = /\[([^\]\n]*)\]\((?:[^()\n]|\([^()\n]*\))*\)/g;
const LINK_REF_RE = /\[([^\]\n]+)\]\[[^\]\n]*\]/g;
const AUTOLINK_RE = /<((?:https?|ftp|mailto):[^\s<>]*|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>/g;

const isBlankChar = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function toPlain(md: string, blocks: boolean): string {
  const src = md.replace(/\r\n?/g, '\n');
  const stash: string[] = [];
  const hold = (s: string) => `${stash.push(s) - 1}`;

  // 1. Code first: fences dropped, spans parked verbatim (nothing below may touch them).
  let text = '';
  let cursor = 0;
  for (const region of codeRegions(src, blocks)) {
    text += src.slice(cursor, region.start);
    text += region.kind === 'code' ? hold(codeSpanText(src.slice(region.start, region.end))) : '';
    cursor = region.end;
  }
  text += src.slice(cursor);

  // 2. Poll / embed tokens — before escapes, since their `\[…\]` form is escaped.
  text = text.replace(POLL_TOKEN_GLOBAL_RE, ' ').replace(EMBED_TOKEN_ANY_RE, ' ');
  // 3. Backslash escapes become literal characters no later pass can read as syntax.
  text = text.replace(ESCAPE_RE, (_, ch: string) => hold(ch));
  // 4. HTML that is not text at all.
  text = text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  // 5. Line-start block syntax (headings, quotes, lists, rules, table delimiters).
  if (blocks) text = stripBlockSyntax(text);
  // 6. Inline constructs: images vanish, links keep their label, autolinks their address.
  text = text
    .replace(IMAGE_RE, ' ')
    .replace(IMAGE_REF_RE, ' ')
    .replace(LINK_RE, '$1')
    .replace(LINK_REF_RE, '$1')
    .replace(AUTOLINK_RE, (_, address: string) => hold(address));
  // 7. Real tags only.
  text = text.replace(new RegExp(TAG_SOURCE, 'g'), (_, name: string) => (BLOCK_TAGS.has(name.toLowerCase()) ? ' ' : ''));
  // 8. Emphasis / strike / table pipes / hard breaks.
  text = text
    .replace(/\*+/g, (run, at: number, s: string) => (isBlankChar(s[at - 1]) && isBlankChar(s[at + run.length]) ? run : ''))
    .replace(/_+/g, (run, at: number, s: string) => (isWordChar(s[at - 1]) && isWordChar(s[at + run.length]) ? run : ''))
    .replace(/~{2,}/g, '')
    .replace(/\\(?=\n|$)/g, '');
  if (blocks) text = text.replace(/\|/g, ' ');
  // 9. Entities once, then the parked literals back in.
  text = decodeEntities(text).replace(STASH_RE, (_, i: string) => stash[Number(i)] ?? '');
  return text.replace(/\s+/g, ' ').trim();
}

function clip(text: string, max: number | undefined): string {
  if (max === undefined || !Number.isFinite(max) || text.length <= max) return text;
  const cps = Array.from(text);
  if (cps.length <= max) return text;
  return `${cps.slice(0, Math.max(0, Math.floor(max))).join('').trimEnd()}…`;
}

/**
 * A stored markdown body as one line of plain text: code blocks, poll/embed
 * tokens, images and HTML markup removed, links reduced to their labels,
 * markdown syntax dropped, entities decoded, whitespace collapsed. With `max`,
 * cut to that many code points and suffixed with `…`.
 */
export function markdownToPlainText(md: string | null | undefined, opts: { max?: number } = {}): string {
  if (!md) return '';
  return clip(toPlain(md, true) || firstCodeLine(md), opts.max);
}

/**
 * The first non-blank line INSIDE a fenced code block — the fallback for a body
 * that is nothing but code (see the header). Verbatim like inline code: no
 * markdown, tag or entity pass, only whitespace collapsed. The opening fence
 * line (with its info string) and a closing fence are never content.
 */
function firstCodeLine(md: string): string {
  const src = md.replace(/\r\n?/g, '\n');
  for (const region of fenceRegions(src)) {
    const lines = src.slice(region.start, region.end).split('\n').slice(1);
    if (region.closed) lines.pop();
    for (const line of lines) {
      const text = line.replace(/\s+/g, ' ').trim();
      if (text) return text;
    }
  }
  return '';
}

/**
 * Plain text of ONE line of inline markdown — a heading's content. No
 * block-syntax pass (`## 1. Setup` must keep its `1.`) and pipes stay. Matches
 * what the rendered element's textContent says, which is what the client-side
 * heading-id assignment slugs.
 */
export function markdownInlineToPlainText(md: string | null | undefined): string {
  if (!md) return '';
  return toPlain(md, false);
}
