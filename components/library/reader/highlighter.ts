// Reader highlighting via the CSS Custom Highlight API. Unlike the old
// wrapRange approach this NEVER mutates the DOM — highlights are painted by the
// browser from live Range objects — so it can't conflict with React's
// dangerouslySetInnerHTML, never flickers, and never drifts. Ranges are located
// by quote (whitespace-insensitive) so a highlight re-anchors reliably.

import { locateQuote } from './anchoring';

export interface OwnMark {
  id: string;
  chapterIndex: number;
  quote: string;
  charStart: number;
  color: string;
}

export interface CommunityMark {
  id: string;
  chapterIndex: number;
  quote: string;
  charStart: number;
  color: string;
}

const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;

export function supportsHighlightApi(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    'highlights' in CSS &&
    typeof (globalThis as { Highlight?: unknown }).Highlight === 'function'
  );
}

interface HitEntry {
  id: string;
  kind: 'own' | 'community';
  range: Range;
}

/**
 * Owns all reader highlights for one document. Named per color so ::highlight()
 * can style each; a single `renderAll` rebuilds every range from the current
 * chapter roots. Keeps a hit list for click-to-locate and margin positioning.
 */
export class ReaderHighlighter {
  private hits: HitEntry[] = [];
  private communityRanges = new Map<string, Range>();
  private ownRanges = new Map<string, Range>();
  private flashName = 'reader-flash';
  private ready = supportsHighlightApi();

  isSupported(): boolean {
    return this.ready;
  }

  /** Rebuild every own + community highlight across all chapter roots. */
  renderAll(roots: Map<number, HTMLElement>, own: OwnMark[], community: CommunityMark[]): void {
    if (!this.ready) return;
    const byColor: Record<string, Range[]> = { yellow: [], green: [], blue: [], pink: [] };
    const communityRanges: Range[] = [];
    this.hits = [];
    this.communityRanges.clear();
    this.ownRanges.clear();

    for (const [ci, root] of roots) {
      for (const m of own) {
        if (m.chapterIndex !== ci) continue;
        const range = locateQuote(root, m.quote, m.charStart);
        if (!range) continue;
        const color = COLORS.includes(m.color as (typeof COLORS)[number]) ? m.color : 'yellow';
        byColor[color].push(range);
        this.hits.push({ id: m.id, kind: 'own', range });
        if (!this.ownRanges.has(m.id)) this.ownRanges.set(m.id, range);
      }
      for (const n of community) {
        if (n.chapterIndex !== ci) continue;
        const range = locateQuote(root, n.quote, n.charStart);
        if (!range) continue;
        communityRanges.push(range);
        this.hits.push({ id: n.id, kind: 'community', range });
        if (!this.communityRanges.has(n.id)) this.communityRanges.set(n.id, range);
      }
    }

    const H = (globalThis as { Highlight: new (...r: Range[]) => Highlight }).Highlight;
    for (const color of COLORS) {
      const name = `reader-hl-${color}`;
      if (byColor[color].length === 0) CSS.highlights.delete(name);
      else CSS.highlights.set(name, new H(...byColor[color]));
    }
    if (communityRanges.length === 0) CSS.highlights.delete('reader-community');
    else CSS.highlights.set('reader-community', new H(...communityRanges));
  }

  /** Which own-highlight (if any) sits under a viewport point. */
  ownHitAt(x: number, y: number): { id: string; rect: DOMRect } | null {
    for (const hit of this.hits) {
      if (hit.kind !== 'own') continue;
      const rects = hit.range.getClientRects();
      for (const r of Array.from(rects)) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
          return { id: hit.id, rect: hit.range.getBoundingClientRect() };
        }
      }
    }
    return null;
  }

  /** Which community-note (if any) sits under a viewport point. */
  communityHitAt(x: number, y: number): string | null {
    for (const hit of this.hits) {
      if (hit.kind !== 'community') continue;
      const rects = hit.range.getClientRects();
      for (const r of Array.from(rects)) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return hit.id;
      }
    }
    return null;
  }

  /** First client rect of a community note, for margin-marker positioning. */
  communityRect(noteId: string): DOMRect | null {
    const range = this.communityRanges.get(noteId);
    return range ? range.getBoundingClientRect() : null;
  }

  communityNoteIds(): string[] {
    return [...this.communityRanges.keys()];
  }

  /** Recolor is just a re-render at the call site; expose range for scroll. */
  ownRange(id: string): Range | null {
    return this.ownRanges.get(id) ?? null;
  }

  /** Flash a located quote (temporary highlight) and scroll it into view. */
  flash(root: HTMLElement, quote: string, charStart: number): boolean {
    if (!this.ready) return false;
    const range = locateQuote(root, quote, charStart);
    if (!range) return false;
    const H = (globalThis as { Highlight: new (...r: Range[]) => Highlight }).Highlight;
    CSS.highlights.set(this.flashName, new H(range));
    const target = range.startContainer.parentElement;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => CSS.highlights.delete(this.flashName), 2400);
    return true;
  }

  /** Scroll an existing own highlight into view + brief flash. */
  flashOwn(id: string): boolean {
    const range = this.ownRanges.get(id);
    if (!this.ready || !range) return false;
    const H = (globalThis as { Highlight: new (...r: Range[]) => Highlight }).Highlight;
    CSS.highlights.set(this.flashName, new H(range));
    const target = range.startContainer.parentElement;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => CSS.highlights.delete(this.flashName), 2400);
    return true;
  }

  dispose(): void {
    if (!this.ready) return;
    for (const color of COLORS) CSS.highlights.delete(`reader-hl-${color}`);
    CSS.highlights.delete('reader-community');
    CSS.highlights.delete(this.flashName);
    this.hits = [];
    this.communityRanges.clear();
    this.ownRanges.clear();
  }
}
