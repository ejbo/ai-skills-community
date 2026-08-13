import { describe, it, expect } from 'vitest';
import { sanitizeChapterHtml, htmlToPlainText } from '@/lib/library/sanitize';

describe('sanitizeChapterHtml — block structure', () => {
  it('wraps the <div> soup a contenteditable emits back into paragraphs', () => {
    // DOMPurify has no `div` in its allowlist, so it UNWRAPS one. Without the
    // normalization pass the chapter editor's output collapses into a single
    // run-on block, taking htmlToPlainText's paragraph boundaries — and every
    // chunk / highlight offset derived from them — with it.
    const html = sanitizeChapterHtml('<p>first</p><div>second</div><div>third</div>', {
      baseUrl: null,
    });
    expect(html).toBe('<p>first</p><p>second</p><p>third</p>');
    expect(htmlToPlainText(html)).toBe('first\n\nsecond\n\nthird');
  });

  it('wraps bare text and inline runs at the top level', () => {
    const html = sanitizeChapterHtml('loose text <strong>bold</strong><p>real</p>', {
      baseUrl: null,
    });
    expect(html).toBe('<p>loose text <strong>bold</strong></p><p>real</p>');
  });

  it('leaves already-structured content untouched', () => {
    const src = '<h2>Title</h2><ul><li>a</li></ul><blockquote>q</blockquote>';
    expect(sanitizeChapterHtml(src, { baseUrl: null })).toBe(src);
  });

  it('keeps tables, figures and sup/sub — the tags markdown cannot round-trip', () => {
    const src =
      '<figure><img src="/api/library/file/x.png" alt="a"><figcaption>cap</figcaption></figure>' +
      '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table><p>x<sup>2</sup></p>';
    const html = sanitizeChapterHtml(src, { baseUrl: null });
    expect(html).toContain('<figcaption>cap</figcaption>');
    expect(html).toContain('colspan="2"');
    expect(html).toContain('<sup>2</sup>');
  });
});

describe('sanitizeChapterHtml — images', () => {
  it('marks images undraggable so a drag over one still selects text', () => {
    const html = sanitizeChapterHtml('<p><img src="/api/library/file/a.png"></p>', {
      baseUrl: null,
    });
    expect(html).toContain('draggable="false"');
  });

  it('keeps width/height so the box is reserved before the lazy image decodes', () => {
    const html = sanitizeChapterHtml(
      '<p><img src="https://e.com/a.png" width="800" height="450"></p>',
      { baseUrl: null },
    );
    expect(html).toContain('width="800"');
    expect(html).toContain('height="450"');
    expect(html).toContain('loading="lazy"');
  });

  it('still drops images that resolve to neither http nor the library file route', () => {
    const html = sanitizeChapterHtml('<p>text<img src="data:image/png;base64,AAA"></p>', {
      baseUrl: null,
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('text');
  });
});
