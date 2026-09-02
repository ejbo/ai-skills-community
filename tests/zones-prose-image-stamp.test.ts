// The body lightbox is a TWO-FILE contract and nothing else pinned the
// producing half: `lightboxTargetOf` (components/zones/prose-image.ts) only
// accepts an <img> carrying PROSE_IMAGE_ATTR, and the ONLY thing that stamps
// it is MarkdownRenderer's `img` component. Drop the stamp there and every
// zone body image silently stops enlarging while tests/zones-body-lightbox
// (which builds its own markup) stays green. This renders the real component
// on the server — node environment on purpose, since MarkdownRenderer is
// imported by RSC surfaces and must render without a DOM.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { PROSE_IMAGE_ATTR } from '@/components/zones/prose-image';

function render(content: string): string {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const html = renderToString(createElement(MarkdownRenderer, { content, size: 'article' }));
  const seen = errors.mock.calls.map((c) => String(c[0]));
  errors.mockRestore();
  expect(seen).toEqual([]);
  return html;
}

describe('MarkdownRenderer — the prose-image stamp the body lightbox keys on', () => {
  it('stamps an image the author wrote into the body', () => {
    const html = render('## h\n\n![curve](/api/zones/media/image/a.png)\n');
    expect(html).toContain(`${PROSE_IMAGE_ATTR}=""`);
    expect(html).toContain('/api/zones/media/image/a.png');
  });

  it('stamps an image written as raw HTML by the editor too', () => {
    expect(render('<p><img src="/api/uploads/b.png" width="320" alt="b"></p>')).toContain(`${PROSE_IMAGE_ATTR}=""`);
  });

  it('still stamps a LINKED image — the anchor is what `lightboxTargetOf` rejects at click time', () => {
    const html = render('[![a](/api/uploads/c.png)](/zones/x)');
    expect(html).toContain(`${PROSE_IMAGE_ATTR}=""`);
    expect(html).toContain('<a href="/zones/x"');
  });

  it('renders a body with no image without the stamp (nothing to enlarge)', () => {
    const html = render('plain **text** and `code`\n');
    expect(html).not.toContain(PROSE_IMAGE_ATTR);
  });
});
