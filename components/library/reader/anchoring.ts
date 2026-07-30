// Pure DOM anchoring utilities for the reader. Highlights are re-anchored by
// quote text (whitespace-normalized), with the stored charStart used only to
// pick the nearest occurrence. Every step is defensive: anything that cannot
// be resolved is silently skipped — a lost highlight must never break reading.

const FILE_URL_RE = /(src|href)="\/api\/library\/file\//g;

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
 * Linear text offset of a DOM point within `root` — the length of the
 * concatenated text-node content before (node, offset). Matches how highlight
 * charStart/charEnd are recorded, so offsets stay self-consistent client-side.
 */
export function getTextOffsetOfPoint(root: HTMLElement, node: Node, offset: number): number {
  try {
    const r = document.createRange();
    r.selectNodeContents(root);
    r.setEnd(node, offset);
    return r.toString().length;
  } catch {
    return 0;
  }
}

interface Segment {
  node: Text;
  start: number;
}

function collectSegments(root: HTMLElement): { raw: string; segments: Segment[] } {
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
    const { raw, segments } = collectSegments(root);
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
 * Wrap every text-node portion covered by `range` in its own <mark> (text
 * nodes are split at the boundaries, so cross-paragraph quotes become several
 * marks sharing one data-hl-id). Returns the created marks.
 */
export function wrapRange(range: Range, className: string, hlId?: string): HTMLElement[] {
  const marks: HTMLElement[] = [];
  try {
    const targets: { node: Text; start: number; end: number }[] = [];
    const ancestor = range.commonAncestorContainer;
    if (ancestor.nodeType === Node.TEXT_NODE) {
      targets.push({ node: ancestor as Text, start: range.startOffset, end: range.endOffset });
    } else {
      const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n as Text;
        if (!range.intersectsNode(t)) continue;
        const start = t === range.startContainer ? range.startOffset : 0;
        const end = t === range.endContainer ? range.endOffset : t.data.length;
        if (end > start) targets.push({ node: t, start, end });
      }
    }
    for (const { node, start, end } of targets) {
      let piece = node;
      if (start > 0) piece = piece.splitText(start);
      if (end - start < piece.data.length) piece.splitText(end - start);
      if (!piece.data) continue;
      const mark = document.createElement('mark');
      mark.className = className;
      if (hlId) mark.dataset.hlId = hlId;
      piece.parentNode?.insertBefore(mark, piece);
      mark.appendChild(piece);
      marks.push(mark);
    }
  } catch {
    /* partial wraps are harmless — clearHighlights resets everything */
  }
  return marks;
}

export function unwrapMark(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  parent.removeChild(mark);
}

export function esc(id: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : id.replace(/"/g, '\\"');
}

export interface AnchorableHighlight {
  id: string;
  quote: string;
  charStart: number;
  color: string;
}

/** Re-anchor and paint the given highlights; unresolvable ones are skipped. */
export function applyHighlights(root: HTMLElement, highlights: AnchorableHighlight[]): void {
  for (const hl of highlights) {
    try {
      if (root.querySelector(`mark[data-hl-id="${esc(hl.id)}"]`)) continue;
      const range = locateQuote(root, hl.quote, hl.charStart);
      if (!range) continue;
      wrapRange(range, `reader-hl reader-hl-${hl.color}`, hl.id);
    } catch {
      /* skip */
    }
  }
}

/** Unwrap every highlight (and temp flash) mark and re-merge text nodes. */
export function clearHighlights(root: HTMLElement): void {
  try {
    root
      .querySelectorAll('mark[data-hl-id], mark.reader-hl-temp')
      .forEach((m) => unwrapMark(m as HTMLElement));
    root.normalize();
  } catch {
    /* ignore */
  }
}

export function recolorHighlight(root: HTMLElement, id: string, color: string): void {
  try {
    root.querySelectorAll(`mark[data-hl-id="${esc(id)}"]`).forEach((m) => {
      (m as HTMLElement).className = `reader-hl reader-hl-${color}`;
    });
  } catch {
    /* ignore */
  }
}

export function removeHighlightMarks(root: HTMLElement, id: string): void {
  try {
    root.querySelectorAll(`mark[data-hl-id="${esc(id)}"]`).forEach((m) => unwrapMark(m as HTMLElement));
    root.normalize();
  } catch {
    /* ignore */
  }
}

/**
 * Community annotation markers (other readers' shared notes): dotted-underline
 * marks with their own dataset key so own-highlight logic never touches them.
 */
export function applyCommunityMarks(
  root: HTMLElement,
  notes: { id: string; quote: string; charStart: number }[],
): void {
  for (const note of notes) {
    try {
      if (root.querySelector(`mark[data-chl-id="${esc(note.id)}"]`)) continue;
      const range = locateQuote(root, note.quote, note.charStart);
      if (!range) continue;
      const marks = wrapRange(range, 'reader-hl-community');
      for (const m of marks) m.dataset.chlId = note.id;
    } catch {
      /* skip */
    }
  }
}

export function clearCommunityMarks(root: HTMLElement): void {
  try {
    root.querySelectorAll('mark[data-chl-id]').forEach((m) => unwrapMark(m as HTMLElement));
    root.normalize();
  } catch {
    /* ignore */
  }
}

/**
 * Scroll to `quote` (nearest `nearCharStart`) and flash it with a temporary
 * mark that unwraps itself. Used by citation jumps and pending cross-chapter
 * jumps. Returns whether the quote was found.
 */
export function flashQuote(root: HTMLElement, quote: string, nearCharStart: number): boolean {
  const range = locateQuote(root, quote, nearCharStart);
  if (!range) return false;
  const marks = wrapRange(range, 'reader-hl-temp reader-hl-flash');
  if (marks.length === 0) return false;
  marks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => {
    marks.forEach(unwrapMark);
    try {
      root.normalize();
    } catch {
      /* ignore */
    }
  }, 2400);
  return true;
}
