// Reader highlighting, painted BY THE BROWSER.
//
// Highlights are registered with the CSS Custom Highlight API — the same
// machinery that paints ::selection — and styled in reader.css with
// ::highlight(). That means:
//   • nothing is injected into the article DOM, so a React re-render can never
//     wipe a highlight and painting can never interfere with selecting text;
//   • no rectangles are computed or positioned, so a highlight can never sit a
//     few pixels off, cover a margin, an empty line or an image;
//   • the Ranges are LIVE, so highlights follow reflow (font size, panel open,
//     window resize, images decoding) with no recompute at all.
//
// The previous implementation drew absolutely-positioned overlay boxes from
// Range.getClientRects(), which by spec also returns the BORDER BOX of every
// element the range fully contains — that is what painted "extra" blocks over
// whitespace and made blank space clickable. The fallback path below keeps
// overlay boxes for browsers without CSS.highlights, but builds them from
// per-text-node rects (anchoring.textRects), so it has the same geometry.

import { locateMark, locateQuote, textBounds, textRects } from './anchoring';

export interface OwnMark {
  id: string;
  chapterIndex: number;
  quote: string;
  charStart: number;
  charEnd: number;
  color: string;
}

export type CommunityMark = OwnMark;

export interface HlBox {
  key: string;
  id: string;
  kind: 'own' | 'community';
  color: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;
type Color = (typeof COLORS)[number];

/** Registered highlight names — these MUST match the ::highlight() rules in reader.css. */
const NAMES = [
  'reader-hl-yellow',
  'reader-hl-green',
  'reader-hl-blue',
  'reader-hl-pink',
  'reader-hl-community',
  'reader-hl-flash',
] as const;

interface Hit {
  id: string;
  kind: 'own' | 'community';
  /** Palette color for own marks; 'community' for shared notes. */
  color: string;
  range: Range;
}

/**
 * Painting order. Higher wins; ties go to the most recently registered.
 * Community marks sit above own highlights so their dotted underline stays
 * visible where two readers marked the same words; the flash sits above both.
 */
const PRIORITY: Record<string, number> = {
  'reader-hl-community': 1,
  'reader-hl-flash': 10,
};

/**
 * Whether this browser paints highlights natively (Chrome/Edge 105+,
 * Safari 17.2+, Firefox 140+). Must not throw under jsdom, which has a `CSS`
 * global but no highlight registry.
 */
export function supportsNativeHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

function registry(): HighlightRegistry | null {
  return supportsNativeHighlights() ? CSS.highlights : null;
}

/** Locates highlight ranges, hands them to the browser, and hit-tests clicks. */
export class ReaderHighlighter {
  private hits: Hit[] = [];
  private firstRange = new Map<string, Range>(); // `${kind}:${id}` → first range
  private native = supportsNativeHighlights();

  /** Give up every registered highlight (unmount / 原版 PDF view). */
  clear(): void {
    this.hits = [];
    this.firstRange.clear();
    const reg = registry();
    if (!reg) return;
    for (const name of NAMES) reg.delete(name);
  }

  /**
   * Re-locate every own + community mark across the mounted chapter roots and
   * paint them. Returns [] on the native path (the browser paints) and the
   * fallback overlay boxes otherwise, in coordinates relative to `container`'s
   * scrollable content.
   */
  paint(
    roots: Map<number, HTMLElement>,
    own: OwnMark[],
    community: CommunityMark[],
    container: HTMLElement,
  ): HlBox[] {
    this.hits = [];
    this.firstRange.clear();

    const byName = new Map<string, Range[]>();
    const push = (name: string, range: Range) => {
      const list = byName.get(name);
      if (list) list.push(range);
      else byName.set(name, [range]);
    };

    const collect = (mark: OwnMark, kind: 'own' | 'community', root: HTMLElement) => {
      const range = locateMark(root, mark);
      if (!range) return;
      const palette: Color = COLORS.includes(mark.color as Color) ? (mark.color as Color) : 'yellow';
      const color = kind === 'community' ? 'community' : palette;
      this.hits.push({ id: mark.id, kind, color, range });
      const fk = `${kind}:${mark.id}`;
      if (!this.firstRange.has(fk)) this.firstRange.set(fk, range);
      push(kind === 'community' ? 'reader-hl-community' : `reader-hl-${palette}`, range);
    };

    for (const [ci, root] of roots) {
      for (const m of own) if (m.chapterIndex === ci) collect(m, 'own', root);
      for (const n of community) if (n.chapterIndex === ci) collect(n, 'community', root);
    }

    if (this.native) {
      this.commit(byName);
      return [];
    }
    return this.fallbackBoxes(container);
  }

  /** Register the located ranges with the browser (native path). */
  private commit(byName: Map<string, Range[]>): void {
    const reg = registry();
    if (!reg) return;
    for (const name of NAMES) {
      if (name === 'reader-hl-flash') continue; // owned by setFlash
      const ranges = byName.get(name);
      if (!ranges || ranges.length === 0) {
        reg.delete(name);
        continue;
      }
      const hl = new Highlight(...ranges);
      hl.priority = PRIORITY[name] ?? 0;
      reg.set(name, hl);
    }
  }

  /** Overlay boxes for browsers without CSS.highlights — exact text rects only. */
  private fallbackBoxes(container: HTMLElement): HlBox[] {
    const crect = container.getBoundingClientRect();
    const sx = container.scrollLeft;
    const sy = container.scrollTop;
    const boxes: HlBox[] = [];
    for (const hit of this.hits) {
      for (const r of textRects(hit.range)) {
        boxes.push({
          key: `${hit.kind}:${hit.id}:${boxes.length}`,
          id: hit.id,
          kind: hit.kind,
          color: hit.color,
          top: r.top - crect.top + sy,
          left: r.left - crect.left + sx,
          width: r.width,
          height: r.height,
        });
      }
    }
    return boxes;
  }

  /**
   * Paint (or clear) the jump/citation flash. Returns fallback boxes on the
   * non-native path, [] otherwise.
   */
  setFlash(range: Range | null, container: HTMLElement | null): HlBox[] {
    const reg = registry();
    if (this.native && reg) {
      if (!range) {
        reg.delete('reader-hl-flash');
        return [];
      }
      const hl = new Highlight(range);
      hl.priority = PRIORITY['reader-hl-flash'];
      reg.set('reader-hl-flash', hl);
      return [];
    }
    if (!range || !container) return [];
    const crect = container.getBoundingClientRect();
    const sx = container.scrollLeft;
    const sy = container.scrollTop;
    return textRects(range).map((r, i) => ({
      key: `flash:${i}`,
      id: 'flash',
      kind: 'own' as const,
      color: 'flash',
      top: r.top - crect.top + sy,
      left: r.left - crect.left + sx,
      width: r.width,
      height: r.height,
    }));
  }

  /** Scroll a range's first line into view. */
  scrollTo(range: Range): void {
    const target =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Exact hit-test. `caretPositionFromPoint` resolves the click to a real
   * (node, offset) in the text, which `Range.isPointInRange` then tests
   * precisely — no rectangle approximation, so clicking blank space beside a
   * highlighted line no longer counts as a hit. The text-rect check stays as a
   * second gate because the caret API snaps to the NEAREST text even when the
   * click lands in the margin.
   */
  private hitAt(kind: 'own' | 'community', x: number, y: number): Hit | null {
    // One caret resolution for the whole pass — it forces layout.
    const caret = caretAt(x, y);
    // Reverse so the most-recently-added (usually the shortest/topmost) wins.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.kind !== kind) continue;
      // Cheap superset reject first: the bounding box also covers the block
      // boxes of contained elements, so it never excludes a real hit.
      const bounds = h.range.getBoundingClientRect();
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
      if (caret) {
        try {
          // Both the caret offset and the one before it: at a glyph boundary
          // the caret snaps to whichever side is nearer, so testing only one
          // drops legitimate hits on the first/last character of a mark.
          const inRange =
            h.range.isPointInRange(caret.node, caret.offset) ||
            (caret.offset > 0 && h.range.isPointInRange(caret.node, caret.offset - 1));
          if (!inRange) continue;
        } catch {
          continue;
        }
      }
      if (textRects(h.range).some((r) => hitsRect(r, x, y))) return h;
    }
    return null;
  }

  ownHitAt(x: number, y: number): { id: string; rect: DOMRect } | null {
    const h = this.hitAt('own', x, y);
    if (!h) return null;
    return { id: h.id, rect: textBounds(h.range) ?? h.range.getBoundingClientRect() };
  }

  communityHitAt(x: number, y: number): { id: string; rect: DOMRect } | null {
    const h = this.hitAt('community', x, y);
    if (!h) return null;
    return { id: h.id, rect: textBounds(h.range) ?? h.range.getBoundingClientRect() };
  }

  communityRect(noteId: string): DOMRect | null {
    const range = this.firstRange.get(`community:${noteId}`);
    return range ? textBounds(range) : null;
  }

  /** Exact-offset range for a highlight / shared note (quote fallback). */
  locateFlash(root: HTMLElement, m: { charStart: number; charEnd: number; quote: string }): Range | null {
    return locateMark(root, m);
  }

  /** Range for an AI citation (quote-search — chunk offsets aren't DOM offsets). */
  locateCitation(root: HTMLElement, quote: string, charStart: number): Range | null {
    return locateQuote(root, quote, charStart);
  }

  /** First range of an own highlight, for jump-to-own. */
  ownRange(id: string): Range | null {
    return this.firstRange.get(`own:${id}`) ?? null;
  }
}

/**
 * Point-in-mark test with a 2px pointer tolerance.
 *
 * Deliberately NOT expanded to the line box. Blink applies
 * ExpandSelectionRectToLineHeight to ::selection ONLY — a custom
 * ::highlight() background is painted at the text rect itself (measured: a
 * 17px/1.75 paragraph paints 19px bands with ~11px unpainted leading between
 * them). Padding out to the line box would make that blank leading clickable,
 * which is precisely the "hits things I didn't mark" complaint this rewrite
 * exists to fix. 2px stays far inside the gap.
 */
function hitsRect(r: DOMRect, x: number, y: number): boolean {
  const PAD = 2;
  return x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD;
}

interface CaretPoint {
  node: Node;
  offset: number;
}

/** Standard caretPositionFromPoint with the WebKit caretRangeFromPoint fallback. */
function caretAt(x: number, y: number): CaretPoint | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  try {
    if (typeof d.caretPositionFromPoint === 'function') {
      const p = d.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (typeof d.caretRangeFromPoint === 'function') {
      const r = d.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
  } catch {
    /* fall through to rect-only hit testing */
  }
  return null;
}
