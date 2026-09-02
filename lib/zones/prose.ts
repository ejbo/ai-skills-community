// 技术专区 — reading typography of a post body. Plain module: composed by
// MarkdownRenderer size="article" (reader) and RichTextEditor size="article"
// (composer) so the writing measure equals the reading measure. Chrome stays
// 14 px; only the article prose grows to 17 px / 1.75.

export const ARTICLE_PROSE_CLASS =
  'prose prose-zinc max-w-none text-[17px] leading-[1.75] dark:prose-invert prose-headings:tracking-tight prose-headings:font-semibold prose-h2:mt-[1.8em] prose-h2:mb-[0.6em] prose-h3:mt-[1.5em] prose-p:my-[1.1em] prose-li:my-[0.35em] prose-img:rounded-xl prose-blockquote:not-italic prose-blockquote:border-l-2 prose-blockquote:border-zinc-900 dark:prose-blockquote:border-zinc-100 prose-hr:my-10 break-words';

/** The article column measure (post page article, composer document column). */
export const ARTICLE_MEASURE_CLASS = 'max-w-[720px]';
