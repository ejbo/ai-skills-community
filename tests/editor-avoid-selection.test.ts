// The 文字样式 popover must not cover the text it formats (ED-22). The geometry
// is pure (components/editor/avoid-selection.ts); TextStyleMenu feeds it the
// hook's anchored spot, the panel's real size and the selection's DOM rect.
import { describe, expect, it } from 'vitest';
import { panelAvoidingSelection } from '@/components/editor/avoid-selection';

const VP = { left: 0, top: 0, width: 1440, height: 900 };
// Anchored under the sticky toolbar trigger at x=330, like the live repro.
const PANEL = { left: 330, top: 88, width: 264, height: 411, maxHeight: 800 };

describe('panelAvoidingSelection', () => {
  it('keeps the anchored spot when it does not overlap the selection (or there is none)', () => {
    expect(panelAvoidingSelection(PANEL, { left: 700, top: 100, right: 800, bottom: 120 }, VP)).toEqual(PANEL);
    expect(panelAvoidingSelection(PANEL, null, VP)).toEqual(PANEL);
  });

  it('moves right of a selection it covers (scenario B of the repro: 16 of 16 characters hidden)', () => {
    const sel = { left: 300, top: 100, right: 460, bottom: 124 };
    const out = panelAvoidingSelection(PANEL, sel, VP);
    expect(out.left).toBe(468);
    expect(out.top).toBe(PANEL.top);
    expect(out.left >= sel.right || out.top >= sel.bottom).toBe(true);
  });

  it('goes left when the right side has no room, below when neither side does', () => {
    const nearRight = { left: 1000, top: 100, right: 1300, bottom: 124 };
    const panel = { ...PANEL, left: 1100 };
    expect(panelAvoidingSelection(panel, nearRight, VP).left).toBe(1000 - 8 - 264);

    const wide = { left: 100, top: 100, right: 1340, bottom: 180 }; // a multi-line selection across the column
    const out = panelAvoidingSelection(PANEL, wide, VP);
    expect(out.top).toBe(188);
    expect(out.left).toBe(PANEL.left);
    expect(out.maxHeight).toBeLessThanOrEqual(900 - 8 - 188);
  });

  it('goes above when there is no room below, and never leaves the viewport', () => {
    const low = { left: 100, top: 700, right: 1340, bottom: 880 };
    const out = panelAvoidingSelection({ ...PANEL, top: 600 }, low, VP);
    expect(out.top).toBe(700 - 8 - 411);
    const everywhere = { left: 0, top: 0, right: 1440, bottom: 900 };
    expect(panelAvoidingSelection(PANEL, everywhere, VP)).toEqual(PANEL);
  });
});
