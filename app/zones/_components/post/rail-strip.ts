// Pure rules of the reading page's narrow rail STRIP (PostRail, M12). Plain
// module so the client component stays thin and the rules are unit-tested.
//
// Three inputs open or close the overlay: hover (mouse only), focus (keyboard
// only) and a glyph click. The focus rule needs a guard: a tap on a glyph
// FOCUSES the button before it CLICKS it (Chrome/Edge on any touch-capable
// desktop), so a focus-driven open followed by the click's "touch toggles"
// branch would open and immediately close the overlay — the first tap never
// worked. A focus that arrives within `FOCUS_POINTER_WINDOW_MS` of a pointer
// press is that tap (or a mouse click, where hover already opened it) and is
// ignored; a focus with no recent press is the keyboard.

export const FOCUS_POINTER_WINDOW_MS = 400;

/** Whether a focus event at `now` should open the overlay (i.e. it was not caused by a pointer press). */
export function focusOpensStrip(lastPointerDownAt: number, now: number): boolean {
  return !(now - lastPointerDownAt < FOCUS_POINTER_WINDOW_MS);
}

/**
 * What a glyph click does. A mouse click never closes (hover already opened
 * the overlay, and the click means "show me this section"); touch and pen
 * have no hover, so their tap toggles.
 */
export function stripGlyphAction(pointerType: string, open: boolean): 'reveal' | 'close' {
  if (pointerType === 'mouse') return 'reveal';
  return open ? 'close' : 'reveal';
}
