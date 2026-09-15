// Which theme GROUND an element sits on — the JS half of the rule in
// app/rich-text.css. Import-free and DOM-only, so the editor can call it from
// an effect and a jsdom test can pin it.
//
// Two theme axes meet inside the 知识库 reader: `.reader-root[data-reader-theme]`
// (浅色 / 护眼 / 深色 / 自动) and the site's `[data-theme]`. The reader's own
// panels follow the reader. But a site `.surface` card mounted inside it — the
// shared DocComments board in the 评论 tab — is painted by the SITE theme, and
// so are its prose text and its `dark:` chrome. Formatting colours and the
// 文字样式 popover must follow the ground they are shown on, or reader 深色 over
// a white site card paints yellow at 1.5 : 1.

export type RichTextTone = 'default' | 'reader';

/** Selector of the reader shell whose theme axis differs from the site's. */
export const READER_ROOT_SELECTOR = '.reader-root';
/** A site-themed card: `.surface` always paints `--surface`, which the reader never redefines. */
export const SITE_SURFACE_SELECTOR = '.surface';

/**
 * 'reader' only when the nearest themed ground above `el` is the reader shell
 * itself; a site `.surface` between them (or no reader at all) means 'default'.
 */
export function richTextToneFor(el: Element | null | undefined): RichTextTone {
  const reader = el?.closest(READER_ROOT_SELECTOR);
  if (!reader) return 'default';
  const surface = el?.closest(SITE_SURFACE_SELECTOR);
  return surface && reader.contains(surface) ? 'default' : 'reader';
}
