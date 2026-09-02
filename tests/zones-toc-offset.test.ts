// Pure decisions of the 技术专区 reading page (WP5): the TOC's active entry,
// the mobile action bar's hide-on-scroll, the body-image lightbox FLIP and
// the narrow rail strip's open/close rules. Most are exported from the client
// components themselves (there is no separate module to own them); importing
// the modules is import-only — no React tree is rendered here.

import { describe, expect, it } from 'vitest';
import { TOP_OFFSET_PX, activeHeadingFor } from '@/app/zones/_components/post/PostToc';
import { nextActionBarHidden } from '@/app/zones/_components/post/PostActionBar';
import { flipFrom } from '@/app/zones/_components/post/BodyImageLightbox';
import { READ_PROGRESS_TOP_PX, readProgress } from '@/app/zones/_components/post/ReadProgress';
import { FOCUS_POINTER_WINDOW_MS, focusOpensStrip, stripGlyphAction } from '@/app/zones/_components/post/rail-strip';

describe('PostToc — activeHeadingFor', () => {
  const entries = [
    { id: 'a', top: 400 },
    { id: 'b', top: 900 },
    { id: 'c', top: 1400 },
  ];

  it('reads the reading line at 112 px', () => {
    expect(TOP_OFFSET_PX).toBe(112);
  });

  it('is the first heading before any has passed the reading line', () => {
    expect(activeHeadingFor(entries)).toBe('a');
  });

  it('is the LAST heading whose top has passed the reading line', () => {
    expect(activeHeadingFor([{ id: 'a', top: -300 }, { id: 'b', top: 50 }, { id: 'c', top: 700 }])).toBe('b');
    expect(activeHeadingFor([{ id: 'a', top: -300 }, { id: 'b', top: -50 }, { id: 'c', top: 112 }])).toBe('c');
  });

  it('stops at the first heading still below the line (document order wins over a stray earlier one)', () => {
    expect(activeHeadingFor([{ id: 'a', top: -100 }, { id: 'b', top: 500 }, { id: 'c', top: -10 }])).toBe('a');
  });

  it('is empty for no headings', () => {
    expect(activeHeadingFor([])).toBe('');
  });
});

describe('PostActionBar — nextActionBarHidden (M14)', () => {
  it('never hides near the top', () => {
    expect(nextActionBarHidden(true, 40, 30)).toBe(false);
    expect(nextActionBarHidden(false, 79, 30)).toBe(false);
  });

  it('hides on a downward scroll past the jitter guard', () => {
    expect(nextActionBarHidden(false, 300, 7)).toBe(true);
    expect(nextActionBarHidden(false, 300, 60)).toBe(true);
  });

  it('shows on any upward scroll past the guard', () => {
    expect(nextActionBarHidden(true, 300, -7)).toBe(false);
  });

  it('ignores sub-guard jitter in either direction', () => {
    expect(nextActionBarHidden(true, 300, 3)).toBe(true);
    expect(nextActionBarHidden(true, 300, -3)).toBe(true);
    expect(nextActionBarHidden(false, 300, 6)).toBe(false);
    expect(nextActionBarHidden(false, 300, -6)).toBe(false);
  });
});

describe('BodyImageLightbox — flipFrom (M16)', () => {
  const box = { left: 320, top: 100, width: 800, height: 600 };

  it('maps the resting box back onto the clicked rect (centre-origin translate + scale)', () => {
    const from = { left: 100, top: 50, width: 400, height: 300 };
    expect(flipFrom(from, box)).toEqual({ x: 300 - 720, y: 200 - 400, scaleX: 0.5, scaleY: 0.5 });
  });

  it('is the identity when the rect and the box coincide', () => {
    expect(flipFrom(box, box)).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
  });

  it('is the identity for a box that has no size yet (image not laid out — wait for onLoad)', () => {
    expect(flipFrom({ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1 });
  });
});

describe('ReadProgress — readProgress (M10)', () => {
  // Article at document offset 300, 3000 px tall, 900 px viewport.
  const top = 300;
  const height = 3000;
  const vh = 900;

  it('shares the TOC reading line', () => {
    expect(READ_PROGRESS_TOP_PX).toBe(112);
  });

  it('is 0 until the article top reaches the reading line', () => {
    expect(readProgress(0, top, height, vh)).toBe(0);
    expect(readProgress(top - 112, top, height, vh)).toBe(0);
  });

  it('is 1 once the article end meets the viewport bottom', () => {
    expect(readProgress(top + height - vh, top, height, vh)).toBe(1);
    expect(readProgress(99_999, top, height, vh)).toBe(1);
  });

  it('is linear in between', () => {
    const start = top - 112;
    const end = top + height - vh;
    expect(readProgress(start + (end - start) / 2, top, height, vh)).toBeCloseTo(0.5, 6);
  });

  it('treats an article shorter than the window as unread / read', () => {
    expect(readProgress(0, 300, 200, 900)).toBe(0);
    expect(readProgress(300, 300, 200, 900)).toBe(1);
  });
});

describe('PostRail strip — focusOpensStrip / stripGlyphAction (M12)', () => {
  it('opens on a keyboard focus (no pointer press on record, or a stale one)', () => {
    expect(focusOpensStrip(Number.NEGATIVE_INFINITY, 12)).toBe(true);
    expect(focusOpensStrip(1000, 1000 + FOCUS_POINTER_WINDOW_MS)).toBe(true);
    expect(focusOpensStrip(1000, 5000)).toBe(true);
  });

  it('ignores the focus a tap or click causes (a pointer went down just before it)', () => {
    expect(focusOpensStrip(1000, 1000)).toBe(false);
    expect(focusOpensStrip(1000, 1030)).toBe(false);
    expect(focusOpensStrip(1000, 1000 + FOCUS_POINTER_WINDOW_MS - 1)).toBe(false);
  });

  it('a mouse click reveals whether or not hover already opened the overlay', () => {
    expect(stripGlyphAction('mouse', false)).toBe('reveal');
    expect(stripGlyphAction('mouse', true)).toBe('reveal');
  });

  it('a touch or pen tap toggles — first tap opens, second closes', () => {
    expect(stripGlyphAction('touch', false)).toBe('reveal');
    expect(stripGlyphAction('touch', true)).toBe('close');
    expect(stripGlyphAction('pen', true)).toBe('close');
  });

  it('the first tap sequence (pointerdown → focus → click) ends open, the second ends closed', () => {
    // Simulates the browser's order on a touch-capable desktop.
    let open = false;
    const tap = (at: number) => {
      const pointerDownAt = at;
      if (focusOpensStrip(pointerDownAt, at + 20)) open = true; // focus fires ~20 ms after the press
      open = stripGlyphAction('touch', open) === 'reveal';
    };
    tap(1000);
    expect(open).toBe(true);
    tap(2000);
    expect(open).toBe(false);
  });
});
