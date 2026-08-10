// Reader highlighting as an OVERLAY layer (alphaXiv-style): highlights are
// absolutely-positioned translucent boxes computed from each range's
// getClientRects(), rendered in a layer that is NOT part of the article DOM.
// Because nothing is injected into the article, React re-renders / normalize /
// effects can never wipe a highlight — it structurally cannot "flash and
// disappear". Coordinates are content-relative (scrollTop-adjusted) so the
// layer scrolls naturally with the text and needs recompute only on layout
// change, not on scroll. Anchoring stays exact via locateMark (offsets).

import { locateMark, locateQuote } from './anchoring';

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

interface Hit {
  id: string;
  kind: 'own' | 'community';
  range: Range;
}

/** Computes highlight overlay boxes + supports hit-testing and flash-jumps. */
export class ReaderHighlighter {
  private hits: Hit[] = [];
  private firstRange = new Map<string, Range>(); // `${kind}:${id}` → first range

  /**
   * Recompute every own + community box across all chapter roots, in
   * coordinates relative to `container`'s scrollable content.
   */
  computeBoxes(
    roots: Map<number, HTMLElement>,
    own: OwnMark[],
    community: CommunityMark[],
    container: HTMLElement,
  ): HlBox[] {
    this.hits = [];
    this.firstRange.clear();
    const crect = container.getBoundingClientRect();
    const sx = container.scrollLeft;
    const sy = container.scrollTop;
    const boxes: HlBox[] = [];

    const emit = (id: string, kind: 'own' | 'community', color: string, range: Range) => {
      this.hits.push({ id, kind, range });
      const fk = `${kind}:${id}`;
      if (!this.firstRange.has(fk)) this.firstRange.set(fk, range);
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width < 1 || r.height < 1) continue;
        boxes.push({
          key: `${kind}:${id}:${boxes.length}`,
          id,
          kind,
          color,
          top: r.top - crect.top + sy,
          left: r.left - crect.left + sx,
          width: r.width,
          height: r.height,
        });
      }
    };

    for (const [ci, root] of roots) {
      for (const m of own) {
        if (m.chapterIndex !== ci) continue;
        const range = locateMark(root, m);
        if (!range) continue;
        const color = COLORS.includes(m.color as (typeof COLORS)[number]) ? m.color : 'yellow';
        emit(m.id, 'own', color, range);
      }
      for (const n of community) {
        if (n.chapterIndex !== ci) continue;
        const range = locateMark(root, n);
        if (!range) continue;
        emit(n.id, 'community', n.color, range);
      }
    }
    return boxes;
  }

  private hitAt(kind: 'own' | 'community', x: number, y: number): Hit | null {
    // Reverse so the most-recently-emitted (usually the shortest/topmost) wins.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (h.kind !== kind) continue;
      for (const r of Array.from(h.range.getClientRects())) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return h;
      }
    }
    return null;
  }

  ownHitAt(x: number, y: number): { id: string; rect: DOMRect } | null {
    const h = this.hitAt('own', x, y);
    return h ? { id: h.id, rect: h.range.getBoundingClientRect() } : null;
  }

  communityHitAt(x: number, y: number): string | null {
    return this.hitAt('community', x, y)?.id ?? null;
  }

  communityRect(noteId: string): DOMRect | null {
    return this.firstRange.get(`community:${noteId}`)?.getBoundingClientRect() ?? null;
  }

  private scrollTo(range: Range): void {
    const target =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** Flash a highlight / shared note by exact offsets (quote fallback). Returns
   *  the flash boxes for the caller to render, or null. */
  locateFlash(root: HTMLElement, m: { charStart: number; charEnd: number; quote: string }): Range | null {
    return locateMark(root, m);
  }

  /** Range for an AI citation (quote-search — chunk offsets aren't DOM offsets). */
  locateCitation(root: HTMLElement, quote: string, charStart: number): Range | null {
    return locateQuote(root, quote, charStart);
  }

  /** Scroll a range into view and return its content-relative flash boxes. */
  flashBoxes(range: Range, container: HTMLElement): HlBox[] {
    this.scrollTo(range);
    const crect = container.getBoundingClientRect();
    const sx = container.scrollLeft;
    const sy = container.scrollTop;
    const boxes: HlBox[] = [];
    const rects = range.getClientRects();
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (r.width < 1 || r.height < 1) continue;
      boxes.push({
        key: `flash:${i}`,
        id: 'flash',
        kind: 'own',
        color: 'flash',
        top: r.top - crect.top + sy,
        left: r.left - crect.left + sx,
        width: r.width,
        height: r.height,
      });
    }
    return boxes;
  }

  /** First range of an own highlight, for jump-to-own. */
  ownRange(id: string): Range | null {
    return this.firstRange.get(`own:${id}`) ?? null;
  }
}
