// Pure DOM anchoring utilities for the reader. A highlight is located by its
// exact character offsets, with the stored quote as the verification key and
// the fallback when the rendered text has shifted. Every step is defensive:
// anything that cannot be resolved is silently skipped — a lost highlight must
// never break reading.
//
// Nothing here MUTATES the article. Painting is the browser's job (CSS Custom
// Highlight API, see ./highlighter.ts); this module only produces Ranges.

const FILE_URL_RE = /(src|href)="\/api\/library\/file\//g;

/** How much of the stored quote must line up with the offset range to trust it. */
const QUOTE_PROBE_CHARS = 24;

/**
 * Chapter HTML stores media URLs root-relative; prefix them with the deploy
 * basePath before dangerouslySetInnerHTML (raw <img src> is not covered by the
 * fetch shim). NEXT_PUBLIC_* is build-time inlined, so reading it here is fine.
 */
export function applyBasePathToHtml(html: string): string {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  if (!bp) return html;
  return html.replace(FILE_URL_RE, `$1="${bp}/api/library/file/`);
}

/**
 * Inverse of applyBasePathToHtml — media URLs are STORED root-relative, so any
 * editor that round-trips displayed HTML back to the server must undo the
 * prefix or the next deploy-path change would bake `/ai-community` into the DB.
 */
export function stripBasePathFromHtml(html: string): string {
  const bp = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  if (!bp) return html;
  return html.split(`="${bp}/api/library/file/`).join('="/api/library/file/');
}

/**
 * Linear text offset of a DOM point within `root` — the length of the
 * concatenated text-node content before (node, offset). Matches how highlight
 * charStart/charEnd are recorded, so offsets stay self-consistent client-side.
 * Null when the browser rejects the point: returning 0 there used to silently
 * anchor the highlight at the TOP of the chapter.
 */
export function getTextOffsetOfPoint(root: HTMLElement, node: Node, offset: number): number | null {
  try {
    const r = document.createRange();
    r.selectNodeContents(root);
    r.setEnd(node, offset);
    return r.toString().length;
  } catch {
    return null;
  }
}

/** Total text length of a chapter root, in the same offset space. */
export function rootTextLength(root: HTMLElement): number {
  return segmentsFor(root).raw.length;
}

interface Segment {
  node: Text;
  start: number;
}

interface Segments {
  raw: string;
  segments: Segment[];
}

// One TreeWalker pass per chapter root, reused across every mark. Re-anchoring
// N highlights used to walk the whole chapter N times and rebuild its full text
// N times, which starved the main thread of mousemove events mid-drag.
let segmentCache = new WeakMap<HTMLElement, Segments>();

function collectSegments(root: HTMLElement): Segments {
  const segments: Segment[] = [];
  let raw = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    segments.push({ node: t, start: raw.length });
    raw += t.data;
  }
  return { raw, segments };
}

/**
 * Cached segments for `root`, revalidated on every read. Ranges built from
 * detached text nodes register fine but paint NOTHING, so a stale cache would
 * silently unpaint every mark — this probe is correctness, not caching hygiene.
 *
 * Probing only the first segment is not enough: chapter HTML is pretty-printed,
 * so segment 0 is usually a whitespace-only node between block tags, and the
 * in-page translators that motivate this check rewrite only nodes that carry
 * text. Both ends plus the total length catch a partial rewrite.
 */
function segmentsFor(root: HTMLElement): Segments {
  const cached = segmentCache.get(root);
  if (cached && isCacheLive(root, cached)) return cached;
  const fresh = collectSegments(root);
  segmentCache.set(root, fresh);
  return fresh;
}

function isCacheLive(root: HTMLElement, cached: Segments): boolean {
  const { segments, raw } = cached;
  if (segments.length === 0) return (root.textContent ?? '').length === 0;
  const first = segments[0].node;
  const last = segments[segments.length - 1].node;
  if (!first.isConnected || !last.isConnected) return false;
  if (!root.contains(first) || !root.contains(last)) return false;
  // textContent concatenates the same text nodes collectSegments walks, so a
  // length change means nodes were added, removed or rewritten in between.
  return (root.textContent ?? '').length === raw.length;
}

/** Drop the cached text walk for a root, or for every root when omitted. */
export function invalidateAnchorCache(root?: HTMLElement): void {
  if (root) segmentCache.delete(root);
  else segmentCache = new WeakMap();
}

function pointAt(segments: Segment[], rawOffset: number): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = segments.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= rawOffset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return null;
  const seg = segments[ans];
  return { node: seg.node, offset: Math.min(rawOffset - seg.start, seg.node.data.length) };
}

/**
 * Find `quote` in the rendered chapter and return a DOM Range for the
 * occurrence whose start is nearest `nearCharStart`. Matching strips ALL
 * whitespace on both sides: server-side chapter text separates blocks with
 * '\n\n' while adjacent DOM text nodes may abut with no whitespace at all, so
 * collapsing (rather than removing) would fail on any cross-paragraph quote.
 * False positives are negligible at quote length and nearest-offset picks the
 * right occurrence. Null when the quote no longer matches.
 */
export function locateQuote(root: HTMLElement, quote: string, nearCharStart: number): Range | null {
  try {
    const target = quote.replace(/\s+/g, '');
    if (!target) return null;
    const { raw, segments } = segmentsFor(root);
    if (!raw) return null;

    // Whitespace-free haystack + map from normalized index → raw index.
    let norm = '';
    const map: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) continue;
      norm += ch;
      map.push(i);
    }

    let best: { rawStart: number; rawEnd: number } | null = null;
    for (let idx = norm.indexOf(target); idx !== -1; idx = norm.indexOf(target, idx + 1)) {
      const rawStart = map[idx];
      const rawEnd = map[idx + target.length - 1] + 1;
      if (!best || Math.abs(rawStart - nearCharStart) < Math.abs(best.rawStart - nearCharStart)) {
        best = { rawStart, rawEnd };
      }
    }
    if (!best) return null;

    const start = pointAt(segments, best.rawStart);
    const end = pointAt(segments, best.rawEnd);
    if (!start || !end) return null;
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

/**
 * Build the EXACT range from stored character offsets. charStart/charEnd are
 * recorded with getTextOffsetOfPoint (concatenated text-node length), and
 * collectSegments concatenates the same raw text — so this reconstructs the
 * precise selection regardless of length. This is the PRIMARY anchor for user
 * highlights and shared notes (same rendered HTML ⇒ stable across reloads and
 * across users); quote search is only the fallback.
 */
export function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  try {
    if (!(end > start)) return null;
    const { segments } = segmentsFor(root);
    if (segments.length === 0) return null;
    const s = pointAt(segments, start);
    const e = pointAt(segments, end);
    if (!s || !e) return null;
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    return range.collapsed ? null : range;
  } catch {
    return null;
  }
}

/** Offset-primary, quote-fallback anchor for a highlight / shared note. */
export function locateMark(
  root: HTMLElement,
  m: { charStart: number; charEnd: number; quote: string },
): Range | null {
  const byOffset = rangeFromOffsets(root, m.charStart, m.charEnd);
  if (byOffset) {
    // The offset range must actually START with the stored quote, otherwise the
    // rendered text has shifted (re-extract / chapter edit / a changed
    // sanitizer) and the offsets now point at unrelated words.
    //
    // The previous form ended in `|| got.length >= want.length`, where `want`
    // was a ≤24-char prefix — true for essentially every highlight, so the
    // check always passed and the quote fallback below was unreachable. That is
    // what let stale offsets paint over the wrong sentence forever.
    const got = byOffset.toString().replace(/\s+/g, '');
    const want = m.quote.replace(/\s+/g, '');
    const probe = want.slice(0, QUOTE_PROBE_CHARS);
    if (!probe || got.startsWith(probe)) return byOffset;
  }
  return locateQuote(root, m.quote, m.charStart);
}

/**
 * The rectangles a range's TEXT actually occupies — one per line box, nothing
 * else.
 *
 * Do NOT use Range.getClientRects() for this. CSSOM-View defines it as the text
 * boxes PLUS "the border boxes of each element selected by the range whose
 * parent is not selected", so a range spanning a paragraph break also yields a
 * full-column-width, full-height rect for every contained <p>/<li>/<figure>,
 * and a contained <a>/<strong> yields a duplicate box over its own text. That
 * is what painted highlights over margins, blank space and images ("框到额外的
 * 位置") and made blank space inside a highlighted paragraph clickable.
 *
 * A range confined to a single Text node selects no elements, so per-text-node
 * sub-ranges give exactly the glyph line boxes.
 */
export function textRects(range: Range): DOMRect[] {
  try {
    const start = range.startContainer;
    const end = range.endContainer;
    if (start.nodeType === Node.TEXT_NODE && start === end) {
      return Array.from(range.getClientRects());
    }
    const scope =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentNode
        : range.commonAncestorContainer;
    if (!scope) return [];
    const out: DOMRect[] = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n as Text;
      if (!t.data || !range.intersectsNode(t)) continue;
      const s = t === start ? range.startOffset : 0;
      const e = t === end ? range.endOffset : t.data.length;
      if (e <= s) continue; // a node the range only touches at a boundary
      const sub = document.createRange();
      sub.setStart(t, s);
      sub.setEnd(t, e);
      for (const r of Array.from(sub.getClientRects())) {
        if (r.width >= 1 && r.height >= 1) out.push(r);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Union of a range's text rects — the geometry MarginNotes anchors to. */
export function textBounds(range: Range): DOMRect | null {
  const rects = textRects(range);
  if (rects.length === 0) return null;
  let top = Infinity;
  let left = Infinity;
  let bottom = -Infinity;
  let right = -Infinity;
  for (const r of rects) {
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    bottom = Math.max(bottom, r.bottom);
    right = Math.max(right, r.right);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}
