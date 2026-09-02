// How a rendered mention LOOKS. Kept in its own import-free module because
// MarkdownRenderer is a server component: pulling it from the picker (a client
// component) would drag framer-motion and the editor into every RSC that
// renders markdown.
//
// 配色契约: a mention is CHROME, not material — an ink wash, never a hue. The
// wash is a single `zinc-500/10` so it reads the same on a white article and a
// dark comment card without a `dark:` twin, and the text colour is the theme's
// own ink. It stays a real profile link (underline off, weight up) so it is
// legible next to ordinary prose links, which keep colour + underline.
export const MENTION_CHIP_CLASS =
  'rte-mention rounded px-1 -mx-0.5 font-medium no-underline text-zinc-800 dark:text-zinc-100 bg-zinc-500/10 hover:bg-zinc-500/20 transition-colors';
