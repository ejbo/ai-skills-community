// 封面版式 + 裁切 — the ONE cover contract shared by every surface that lets an
// author decide how a cover image is shown: 投票作品 (VoteEntry.posterAspect /
// posterPos — where this vocabulary was born), 长视频 (Video.posterAspect /
// posterPos) and 技术专区帖子 (ZonePost.coverAspect / coverPos).
//
// Import-free and client-safe: the crop editor, the renderer
// (components/media/CoverImage.tsx) and every write route read the same two
// closed value sets, so a value the editor can produce is a value the server
// accepts and the renderer understands.
//
//   aspect  'landscape' | 'portrait'   the FRAME the author composed for.
//   pos     ''                         居中裁切 — object-cover, centred (the default,
//                                      and what every row written before this had).
//           'contain'                  完整显示 — the whole image over a blurred copy
//                                      of itself; nothing is ever cut off.
//           'x% y%'                    取景位置 — object-cover with that object-position
//                                      (integers 0–100).
//
// Never a free CSS string: `pos` reaches a style attribute, so anything that is
// not one of the three shapes is rejected at the write boundary AND ignored at
// render time (coverObjectPosition falls back to the centre).

export const COVER_ASPECTS = ['landscape', 'portrait'] as const;
export type CoverAspect = (typeof COVER_ASPECTS)[number];

export const COVER_POS_CONTAIN = 'contain';

const POS_RE = /^(\d{1,3})% (\d{1,3})%$/;

/** Validated aspect, or null when the value is not one of the two. `undefined`/`null` ⇒ the default. */
export function parseCoverAspect(raw: unknown): CoverAspect | null {
  if (raw === undefined || raw === null || raw === '') return 'landscape';
  return raw === 'landscape' || raw === 'portrait' ? raw : null;
}

/** Read side: a stored value that drifted (hand-edited row, older build) renders as the default instead of throwing. */
export function coverAspectOf(raw: unknown): CoverAspect {
  return raw === 'portrait' ? 'portrait' : 'landscape';
}

/**
 * Validated three-state position, or null when the value is none of the shapes.
 * `undefined`/`null` ⇒ '' (centre crop). Percentages are normalised (`050%` → `50%`).
 */
export function parseCoverPos(raw: unknown): string | null {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '' || s === COVER_POS_CONTAIN) return s;
  const m = POS_RE.exec(s);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (x > 100 || y > 100) return null;
  return `${x}% ${y}%`;
}

/** Read side twin of parseCoverPos: anything unrecognised renders as the centre crop. */
export function coverPosOf(raw: unknown): string {
  return parseCoverPos(raw) ?? '';
}

export function isContainPos(pos: string | null | undefined): boolean {
  return pos === COVER_POS_CONTAIN;
}

/** The CSS object-position for a crop (`'x% y%'` as stored, the centre for '' and for 'contain'). */
export function coverObjectPosition(pos: string | null | undefined): string {
  return pos && POS_RE.test(pos) ? pos : '50% 50%';
}

/** `{x, y}` percentages of a stored position; the centre for '' / 'contain' / junk. */
export function coverPosPercent(pos: string | null | undefined): { x: number; y: number } {
  const m = pos ? POS_RE.exec(pos) : null;
  return m ? { x: Math.min(100, Number(m[1])), y: Math.min(100, Number(m[2])) } : { x: 50, y: 50 };
}

export function formatCoverPos(x: number, y: number): string {
  const c = (n: number) => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 50)));
  return `${c(x)}% ${c(y)}%`;
}

/** Width ÷ height of the frame an aspect stands for on a VIDEO surface (16:9 / 3:4) — cards, hero artwork, crop editor. */
export function videoCoverRatio(aspect: CoverAspect): number {
  return aspect === 'portrait' ? 3 / 4 : 16 / 9;
}

/** Width ÷ height of a 技术专区 post cover frame (2:1 banner / 3:4 poster). */
export function postCoverRatio(aspect: CoverAspect): number {
  return aspect === 'portrait' ? 3 / 4 : 2 / 1;
}

/**
 * What a freshly picked image should start as, from its natural size.
 *
 * A clearly portrait image (a 海报, a phone screenshot) starts as
 * portrait + 完整显示: the failure this contract exists to prevent is a poster
 * whose title was cut off by a landscape centre crop, so the safe default for a
 * tall image is "show all of it" and the author opts INTO a crop. Anything else
 * keeps the historical default (landscape, centre crop).
 */
export function defaultCoverFor(width: number, height: number): { aspect: CoverAspect; pos: string } {
  if (!(width > 0) || !(height > 0)) return { aspect: 'landscape', pos: '' };
  return height / width >= 1.15 ? { aspect: 'portrait', pos: COVER_POS_CONTAIN } : { aspect: 'landscape', pos: '' };
}
