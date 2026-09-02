// Which <img> a body click may enlarge. Plain module (no DOM at import time,
// no React) so the decision is unit-testable under jsdom and importable by the
// server-rendered MarkdownRenderer.
//
// The test is POSITIVE: only an image the markdown renderer itself produced
// from the author's content carries `PROSE_IMAGE_ATTR`. Everything else that
// can end up under a ZoneMarkdown root — an avatar (PollWidget voters, the
// author row of an embed card), an embed card's thumbnail, a 表情包
// (StickerImage renders its own <img> and owns its click), a hover card
// PORTALED to <body> whose React events still bubble to the root — never has
// the attribute, so none of them can open the lightbox. Two guards on top:
// the element must be a DOM descendant of the root (rejects a portal that
// reaches the handler through the React tree), and it must not sit inside
// something that already owns the click (a linked image navigates).

export const PROSE_IMAGE_ATTR = 'data-prose-img';

const INTERACTIVE_ANCESTOR = 'a, button, [role="button"], [role="link"]';

/** The prose <img> a click on `target` should enlarge, or null. */
export function lightboxTargetOf(target: EventTarget | null, root: Element | null): HTMLImageElement | null {
  if (!root || !(target instanceof Element)) return null;
  const img = target.closest(`img[${PROSE_IMAGE_ATTR}]`);
  if (!(img instanceof HTMLImageElement)) return null;
  if (!root.contains(img)) return null;
  if (img.closest(INTERACTIVE_ANCESTOR)) return null;
  return img;
}
