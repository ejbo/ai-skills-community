// Reader highlighting via DOM <mark> wrapping — the battle-tested approach:
// a <mark> is just an element with a background, so it renders in every browser
// with zero API dependency. The key correctness fix over earlier attempts is
// EXACT offset-based anchoring (locateMark) instead of fuzzy quote search, so a
// highlight/note lands on precisely the selected span, any length. No scroll
// repaint and a stable html prop mean the marks don't flicker or fight React.

import {
  clearCommunityMarks,
  clearHighlights,
  esc,
  locateMark,
  locateQuote,
  unwrapMark,
  wrapRange,
} from './anchoring';

export interface OwnMark {
  id: string;
  chapterIndex: number;
  quote: string;
  charStart: number;
  charEnd: number;
  color: string;
}

export type CommunityMark = OwnMark;

const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;

/**
 * Owns all reader highlights for one document across every chapter root.
 * `renderAll` rebuilds the marks; the rest support click-to-locate, margin
 * positioning and flash-jumps.
 */
export class ReaderHighlighter {
  private roots: Map<number, HTMLElement> = new Map();

  /** Rebuild own + community marks across all chapter roots (idempotent). */
  renderAll(roots: Map<number, HTMLElement>, own: OwnMark[], community: CommunityMark[]): void {
    this.roots = roots;
    for (const [ci, root] of roots) {
      clearHighlights(root);
      clearCommunityMarks(root);
      for (const m of own) {
        if (m.chapterIndex !== ci) continue;
        const range = locateMark(root, m);
        if (!range) continue;
        const color = COLORS.includes(m.color as (typeof COLORS)[number]) ? m.color : 'yellow';
        wrapRange(range, `reader-hl reader-hl-${color}`, m.id);
      }
      for (const n of community) {
        if (n.chapterIndex !== ci) continue;
        const range = locateMark(root, n);
        if (!range) continue;
        const marks = wrapRange(range, 'reader-hl-community');
        for (const mk of marks) mk.dataset.chlId = n.id;
      }
    }
  }

  private markFor(id: string, attr: 'hl' | 'chl'): HTMLElement | null {
    const sel = attr === 'hl' ? `mark[data-hl-id="${esc(id)}"]` : `mark[data-chl-id="${esc(id)}"]`;
    for (const root of this.roots.values()) {
      const el = root.querySelector(sel);
      if (el) return el as HTMLElement;
    }
    return null;
  }

  /** The own-highlight (if any) under a viewport point. */
  ownHitAt(x: number, y: number): { id: string; rect: DOMRect } | null {
    const el = document.elementFromPoint(x, y)?.closest('mark[data-hl-id]') as HTMLElement | null;
    if (el?.dataset.hlId) return { id: el.dataset.hlId, rect: el.getBoundingClientRect() };
    return null;
  }

  /** The community-note (if any) under a viewport point. */
  communityHitAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest('mark[data-chl-id]') as HTMLElement | null;
    return el?.dataset.chlId ?? null;
  }

  /** First mark rect of a community note, for margin-marker positioning. */
  communityRect(noteId: string): DOMRect | null {
    return this.markFor(noteId, 'chl')?.getBoundingClientRect() ?? null;
  }

  private flashRange(range: Range): boolean {
    const marks = wrapRange(range, 'reader-hl-temp reader-hl-flash');
    if (marks.length === 0) return false;
    marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      for (const m of marks) {
        try {
          unwrapMark(m);
        } catch {
          /* ignore */
        }
      }
      for (const root of this.roots.values()) {
        try {
          root.normalize();
        } catch {
          /* ignore */
        }
      }
    }, 2400);
    return true;
  }

  /** Flash a highlight / shared note by its exact offsets (quote fallback). */
  flashMark(root: HTMLElement, m: { charStart: number; charEnd: number; quote: string }): boolean {
    const range = locateMark(root, m);
    return range ? this.flashRange(range) : false;
  }

  /** Flash a quote near an offset — used by AI citations (chunk offsets, not DOM). */
  flash(root: HTMLElement, quote: string, charStart: number): boolean {
    const range = locateQuote(root, quote, charStart);
    return range ? this.flashRange(range) : false;
  }

  /** Scroll an already-painted own highlight into view + brief flash. */
  flashOwn(id: string): boolean {
    const el = this.markFor(id, 'hl');
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash every mark sharing this id.
    for (const root of this.roots.values()) {
      root.querySelectorAll(`mark[data-hl-id="${esc(id)}"]`).forEach((m) => {
        m.classList.add('reader-hl-flash');
        window.setTimeout(() => m.classList.remove('reader-hl-flash'), 2400);
      });
    }
    return true;
  }

  dispose(): void {
    for (const root of this.roots.values()) {
      try {
        clearHighlights(root);
        clearCommunityMarks(root);
      } catch {
        /* ignore */
      }
    }
    this.roots = new Map();
  }
}
