// 技术专区 — ZonePost.summary: what the author typed, or an excerpt of the body.
//
// ONE column holds two different kinds of value. When the author fills 摘要 it
// is their text; when they leave it blank (the placeholder says 留空则自动截取正文)
// the save stores an excerpt of the body instead, so every list row, the post
// header, the notice band and RelatedPosts can read one plain column without
// selecting — and re-parsing — a 200 kB body. Nothing records WHICH kind a row
// holds, and that used to freeze the excerpt forever:
//
//   1. create with 摘要 empty → summary = excerpt of body v1;
//   2. the edit page loaded that excerpt into the 摘要 INPUT as a real value;
//   3. every later save sent it back (and a body-only PATCH re-used the stored
//      one), so the server took it for a typed summary — the card kept
//      describing body v1 after the author rewrote the post.
//
// The fix is recognition, not a new column (a flag would need a migration plus
// a backfill that SQL cannot compute): a stored summary that is EXACTLY the
// excerpt of the body it was saved with is an auto summary. `updateZonePost`
// asks this before deciding what to store, and the edit page asks it before
// filling the input, so the input shows the placeholder and the excerpt keeps
// following the body. The one ambiguity — an author who typed, character for
// character, the first 200 plain-text characters of their own body — is
// harmless: that summary and the excerpt are the same text.
//
// Pure and client-safe (no prisma); unit-tested in tests/zones-post-summary.test.ts.

import { POLL_TOKEN_GLOBAL_RE } from '@/lib/polls-shared';
import { EMBED_TOKEN_GLOBAL_RE, excerptOf } from './shared';

/** Code points of the excerpt stored when 摘要 is left blank (the typed cap is ZONE_LIMITS.postSummaryMax). */
export const AUTO_SUMMARY_MAX = 200;

/** The summary a save stores for a body when the author typed none. */
export function autoPostSummary(bodyMd: string): string {
  return excerptOf(bodyMd, AUTO_SUMMARY_MAX);
}

/**
 * The excerpt rules summaries were stored with before lib/markdown-text.ts
 * (2026-09-14) — a regex chain that, among other differences, turned every `-`
 * into a space (`2026-09-14` → `2026 09 14`). Kept ONLY so the posts written
 * under those rules are still recognised as auto summaries and unfreeze on
 * their next edit; nothing may DISPLAY this. Do not "update" it to the current
 * rules — its whole value is being byte-identical to what those rows hold.
 */
function legacyAutoPostSummary(md: string): string {
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
  return cps.length > AUTO_SUMMARY_MAX ? `${cps.slice(0, AUTO_SUMMARY_MAX).join('')}…` : text;
}

/**
 * Is `summary` the excerpt a save derived from `bodyMd` — i.e. NOT something the
 * author typed? `bodyMd` must be the body the summary was stored WITH (the
 * existing row's body, not an incoming edit). A blank summary is auto too.
 */
export function isAutoPostSummary(summary: string, bodyMd: string): boolean {
  const s = summary.trim();
  if (!s) return true;
  return s === autoPostSummary(bodyMd).trim() || s === legacyAutoPostSummary(bodyMd);
}

/**
 * What an update stores as the summary. `incoming` is the PATCH's summary when
 * it carries one, else the stored summary; `previousBodyMd` is the body the row
 * held before this write. A value that is merely the previous auto excerpt is
 * re-derived from the (possibly new) `bodyMd`; a typed one is kept, capped at
 * `max`.
 */
export function nextPostSummary(o: { incoming: string; previousBodyMd: string; bodyMd: string; max: number }): string {
  const typed = isAutoPostSummary(o.incoming, o.previousBodyMd) ? '' : o.incoming.trim().slice(0, o.max);
  return typed || autoPostSummary(o.bodyMd);
}
