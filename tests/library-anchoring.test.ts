// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTextOffsetOfPoint,
  rangeFromOffsets,
  locateMark,
  wrapRange,
} from '@/components/library/reader/anchoring';

function mount(html: string): HTMLElement {
  const root = document.createElement('article');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

/** Concatenated text-node content — the offset space charStart/charEnd live in. */
function rawText(root: HTMLElement): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let s = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) s += (n as Text).data;
  return s;
}

describe('reader offset anchoring', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('rangeFromOffsets reconstructs the exact substring, any length', () => {
    const root = mount('<p>The quick brown fox</p><p>jumps over the lazy dog</p>');
    const raw = rawText(root);
    // A cross-paragraph span.
    const start = raw.indexOf('brown');
    const end = raw.indexOf('jumps') + 'jumps'.length;
    const range = rangeFromOffsets(root, start, end);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe(raw.slice(start, end));
  });

  it('round-trips a selection: getTextOffsetOfPoint → rangeFromOffsets', () => {
    const root = mount('<p>alpha <strong>beta</strong> gamma delta epsilon</p>');
    const strong = root.querySelector('strong')!.firstChild as Text;
    const range = document.createRange();
    range.setStart(strong, 1); // inside "beta"
    const last = root.querySelectorAll('p')[0].lastChild as Text;
    range.setEnd(last, last.data.length);
    const charStart = getTextOffsetOfPoint(root, range.startContainer, range.startOffset);
    const charEnd = getTextOffsetOfPoint(root, range.endContainer, range.endOffset);
    const rebuilt = rangeFromOffsets(root, charStart, charEnd);
    expect(rebuilt!.toString()).toBe(range.toString());
  });

  it('locateMark prefers exact offsets over an ambiguous quote', () => {
    // "cat" appears twice; offsets must pick the SECOND occurrence.
    const root = mount('<p>a cat here</p><p>another cat there</p>');
    const raw = rawText(root);
    const second = raw.indexOf('cat', raw.indexOf('cat') + 1);
    const range = locateMark(root, { charStart: second, charEnd: second + 3, quote: 'cat' });
    expect(range).not.toBeNull();
    // The located range must be the second "cat" (offset-anchored), not the first.
    expect(range!.startOffset).toBeGreaterThan(0);
    expect(range!.toString()).toBe('cat');
    // And it is inside the SECOND paragraph.
    const p2 = root.querySelectorAll('p')[1];
    expect(p2.contains(range!.startContainer)).toBe(true);
  });

  it('wrapRange marks exactly the offset span (no over/under-selection)', () => {
    const root = mount('<p>one two three four five</p>');
    const raw = rawText(root);
    const start = raw.indexOf('two');
    const end = raw.indexOf('four') + 'four'.length;
    const range = rangeFromOffsets(root, start, end)!;
    const marks = wrapRange(range, 'reader-hl reader-hl-yellow', 'hl1');
    expect(marks.length).toBeGreaterThan(0);
    const marked = Array.from(root.querySelectorAll('mark[data-hl-id="hl1"]'))
      .map((m) => m.textContent)
      .join('');
    expect(marked).toBe(raw.slice(start, end));
  });

  it('locateMark falls back to quote when offsets are stale', () => {
    const root = mount('<p>needle in a haystack</p>');
    // Offsets far past the content → fall back to quote search.
    const range = locateMark(root, { charStart: 9999, charEnd: 10005, quote: 'needle' });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('needle');
  });
});
