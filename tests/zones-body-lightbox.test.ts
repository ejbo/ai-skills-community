// @vitest-environment jsdom
//
// Which <img> a click inside a zone body may enlarge (components/zones/
// prose-image.ts). The decision is POSITIVE — only an image the markdown
// renderer stamped with PROSE_IMAGE_ATTR, sitting in the root's own DOM with
// no link/button ancestor — because the delegated handler on the root also
// receives clicks that bubble through the REACT tree from a hover card
// portaled to <body>, and DOM-only exclusions (an <a> ancestor, an embed
// card wrapper) cannot see that ancestry.

import { describe, expect, it } from 'vitest';
import { PROSE_IMAGE_ATTR, lightboxTargetOf } from '@/components/zones/prose-image';

function root(html: string): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('data-zone-markdown', '');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

const PROSE_IMG = `<img ${PROSE_IMAGE_ATTR}="" src="/api/zones/media/image/a.png" alt="curve">`;

describe('lightboxTargetOf — body image lightbox target', () => {
  it('accepts a prose image the markdown renderer produced', () => {
    const r = root(`<div class="prose"><p>${PROSE_IMG}</p></div>`);
    const img = r.querySelector('img')!;
    expect(lightboxTargetOf(img, r)).toBe(img);
  });

  it('rejects an image without the prose stamp (an avatar, an embed thumbnail, a sticker)', () => {
    const r = root(
      `<div class="prose"><div class="not-prose"><span><img src="/api/uploads/avatars/u.png" alt="U"></span></div></div>` +
        `<div data-embed-kind="post"><img src="/api/zones/media/image/cover.png" alt=""></div>` +
        `<div class="prose"><span class="not-prose"><img src="/api/uploads/stickers/s.gif" alt=""></span></div>`,
    );
    for (const img of r.querySelectorAll('img')) expect(lightboxTargetOf(img, r)).toBeNull();
  });

  it('rejects a linked image (the anchor owns the click) and anything under a button', () => {
    const r = root(
      `<div class="prose"><p><a href="/x">${PROSE_IMG}</a></p></div>` +
        `<div class="prose"><button type="button">${PROSE_IMG}</button></div>` +
        `<div class="prose"><div role="button">${PROSE_IMG}</div></div>`,
    );
    for (const img of r.querySelectorAll('img')) expect(lightboxTargetOf(img, r)).toBeNull();
  });

  it('rejects an image that is not in the root DOM (a portaled hover card whose React events bubble to the root)', () => {
    const r = root(`<div class="prose"><p>${PROSE_IMG}</p></div>`);
    const portal = document.createElement('div');
    portal.setAttribute('role', 'tooltip');
    portal.innerHTML = `<span class="rounded-full">${PROSE_IMG}</span>`;
    document.body.appendChild(portal);
    const portaled = portal.querySelector('img')!;
    expect(r.contains(portaled)).toBe(false);
    expect(lightboxTargetOf(portaled, r)).toBeNull();
    expect(lightboxTargetOf(r.querySelector('img'), r)).not.toBeNull();
  });

  it('ignores clicks on non-image targets and a missing root', () => {
    const r = root(`<div class="prose"><p>text ${PROSE_IMG}</p><h2>h</h2></div>`);
    expect(lightboxTargetOf(r.querySelector('h2'), r)).toBeNull();
    expect(lightboxTargetOf(r.querySelector('p'), r)).toBeNull();
    expect(lightboxTargetOf(null, r)).toBeNull();
    expect(lightboxTargetOf(r.querySelector('img'), null)).toBeNull();
  });
});
