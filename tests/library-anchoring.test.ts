// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getTextOffsetOfPoint,
  rangeFromOffsets,
  locateMark,
  rootTextLength,
  textRects,
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
    expect(charStart).not.toBeNull();
    expect(charEnd).not.toBeNull();
    const rebuilt = rangeFromOffsets(root, charStart!, charEnd!);
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

  it('locateMark falls back to quote when offsets are stale', () => {
    const root = mount('<p>needle in a haystack</p>');
    // Offsets far past the content → fall back to quote search.
    const range = locateMark(root, { charStart: 9999, charEnd: 10005, quote: 'needle' });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('needle');
  });

  it('locateMark REJECTS in-bounds offsets that no longer match the quote', () => {
    // The regression that made highlights land on unrelated sentences: the
    // guard used to accept any offset range at least as long as the quote, so a
    // shifted document painted the wrong words forever.
    const root = mount('<p>AAAA needle BBBB</p>');
    const range = locateMark(root, { charStart: 0, charEnd: 6, quote: 'needle' });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('needle'); // not "AAAA n"
  });

  it('locateMark re-anchors by quote after the text above it shifts', () => {
    const root = mount('<p>needle in a haystack</p>');
    const raw = rawText(root);
    const at = raw.indexOf('needle');
    // Content inserted ABOVE pushes every stored offset out of alignment.
    root.insertAdjacentHTML('afterbegin', '<p>a newly prepended paragraph</p>');
    const range = locateMark(root, { charStart: at, charEnd: at + 6, quote: 'needle' });
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe('needle');
  });

  it('re-anchors against replaced content (the cached text walk self-invalidates)', () => {
    const root = mount('<p>first body text</p>');
    expect(rootTextLength(root)).toBe('first body text'.length);
    // A remount replaces every text node; ranges built from the stale walk
    // would be detached and paint nothing.
    root.innerHTML = '<p>a completely different body</p>';
    expect(rootTextLength(root)).toBe('a completely different body'.length);
    const range = locateMark(root, { charStart: 2, charEnd: 13, quote: 'completely' });
    expect(range).not.toBeNull();
    expect(range!.startContainer.isConnected).toBe(true);
    expect(root.contains(range!.startContainer)).toBe(true);
  });

  it('textRects never throws (jsdom has no layout, so it yields nothing)', () => {
    const root = mount('<p>one two</p><p>three four</p>');
    const raw = rawText(root);
    const range = rangeFromOffsets(root, raw.indexOf('two'), raw.indexOf('four') + 4)!;
    expect(() => textRects(range)).not.toThrow();
    expect(Array.isArray(textRects(range))).toBe(true);
  });
});
