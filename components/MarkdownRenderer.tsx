import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { sanitizeSchema } from '@/lib/markdown';
import { withBasePath } from '@/lib/base-path';
import { isStickerSrc } from '@/lib/stickers';
import { splitPollSegments } from '@/lib/polls-shared';
import { ARTICLE_PROSE_CLASS } from '@/lib/zones/prose';
import { PROSE_IMAGE_ATTR } from '@/components/zones/prose-image';
import { StickerImage } from '@/components/stickers/StickerImage';
import { PollWidget } from '@/components/polls/PollWidget';

// Shared code / table styling for both sizes.
// The prose-code chip styles (bg/px) target EVERY <code>, including the one
// inside <pre>. There, code is an inline element, so the horizontal padding
// paints only at the first line's start — every code block looked like its
// first line was indented by one space. The [&_pre_code]:p-0 overrides zero it out.
const CODE_TABLE =
  'prose-pre:bg-zinc-100 prose-pre:text-zinc-800 dark:prose-pre:bg-zinc-900 dark:prose-pre:text-zinc-100 prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-zinc-800 [&_pre_code]:bg-transparent [&_pre_code]:p-0 dark:[&_pre_code]:bg-transparent prose-table:overflow-hidden prose-th:border prose-th:border-zinc-300 prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-zinc-200 prose-td:px-3 prose-td:py-1.5 dark:prose-th:border-zinc-700 dark:prose-td:border-zinc-800';

// Default reading size (skill description, etc.).
const DEFAULT_CLASS = `prose prose-zinc max-w-none text-[15px] leading-relaxed dark:prose-invert prose-headings:tracking-tight prose-headings:font-semibold ${CODE_TABLE}`;

// Compact size for tight panels (AI summary). Smaller body + much smaller,
// tighter headings so an h2/## doesn't dominate the panel.
const COMPACT_CLASS = `prose prose-sm prose-zinc max-w-none text-[13px] leading-relaxed dark:prose-invert prose-headings:tracking-tight prose-headings:font-semibold prose-h1:text-sm prose-h1:mb-1.5 prose-h1:mt-3 prose-h2:text-[13px] prose-h2:mb-1 prose-h2:mt-3 prose-h3:text-xs prose-h3:mb-1 prose-h3:mt-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 ${CODE_TABLE}`;

// Article size — the 技术专区 post body (17 px / 1.75 on a 720 px measure).
// The prose half lives in lib/zones/prose.ts so the composer's editor wears
// the SAME typography (writing measure = reading measure); code and tables
// stay the house 13 px chrome. Body images are click-to-enlarge on this
// surface (ZoneMarkdown's delegated listener), hence the zoom cursor — an
// image that is itself a link keeps the pointer.
const ARTICLE_CLASS = `${ARTICLE_PROSE_CLASS} prose-img:cursor-zoom-in [&_a_img]:cursor-pointer ${CODE_TABLE}`;

export type MarkdownSize = 'default' | 'compact' | 'article';

const SIZE_CLASS: Record<MarkdownSize, string> = {
  default: DEFAULT_CLASS,
  compact: COMPACT_CLASS,
  article: ARTICLE_CLASS,
};

const REMARK_PLUGINS = [remarkGfm];

// Order matters: parse raw HTML → highlight code → sanitize (last, so
// anything the earlier plugins produced is still scrubbed against the schema).
const REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeHighlight, { ignoreMissing: true, detect: false }],
  [rehypeSanitize, sanitizeSchema],
] as NonNullable<Parameters<typeof ReactMarkdown>[0]['rehypePlugins']>;

// MODULE-LEVEL on purpose: a `components` map written inline in the render
// body is a fresh function identity per render, which React reads as a new
// element type — every <img> and <a> in the body was being unmounted and
// remounted on each re-render (images reloading, a held element reference
// going stale, the lightbox's measured rect pointing at a node that no longer
// exists). Hoisting it keeps the DOM stable across re-renders.
const MD_COMPONENTS: Components = {
  // Apply the deploy basePath to root-relative media (e.g. editor-uploaded
  // images stored as "/api/uploads/...") so they resolve under subpath
  // deploys. Absolute/data/blob URLs pass through unchanged.
  // 表情包 (the /api/uploads/stickers/ namespace — tested on the RAW
  // stored src, BEFORE withBasePath) render through the interactive
  // StickerImage client leaf instead: fixed small box + 添加到表情包.
  // Every other image is stamped PROSE_IMAGE_ATTR — the ONLY signal the
  // zone body's click-to-enlarge accepts (avatars, embed thumbnails and
  // stickers never carry it).
  img: ({ node, src, alt, style, ...props }) => {
    const raw = typeof src === 'string' ? src : '';
    if (isStickerSrc(raw)) {
      return <StickerImage src={raw} alt={alt} />;
    }
    return (
      // Author-set width (HTML <img width=…> from the editor) is honored; keep
      // images responsive + aspect-correct so a wide width never overflows.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={withBasePath(raw)}
        alt={alt ?? ''}
        loading="lazy"
        style={{ maxWidth: '100%', height: 'auto', ...(style as object) }}
        {...{ [PROSE_IMAGE_ATTR]: '' }}
        {...props}
      />
    );
  },
  // External links open in a new tab and ALWAYS get a safe rel (closes
  // reverse-tabnabbing — the sanitize schema permits target/rel, and any
  // stored rel is overridden here). Root-relative hrefs get the basePath.
  a: ({ node, href, target, rel, ...props }) => {
    const h = typeof href === 'string' ? href : '';
    const external = /^(https?:)?\/\//i.test(h);
    return (
      <a
        href={withBasePath(h)}
        target={external ? '_blank' : target}
        rel={external || target === '_blank' ? 'noopener noreferrer nofollow' : rel}
        {...props}
      />
    );
  },
};

// One markdown chunk (poll tokens already split out by the caller).
function Md({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={MD_COMPONENTS}>
      {content}
    </ReactMarkdown>
  );
}

export function MarkdownRenderer({
  content,
  compact = false,
  size,
}: {
  content: string;
  /** Legacy switch for tight panels; `size` wins when both are given. */
  compact?: boolean;
  size?: MarkdownSize;
}) {
  // Own-line `[poll:<id>]` tokens become embedded PollWidget cards; everything
  // else renders as before. No poll ⇒ single segment ⇒ identical output.
  const segments = splitPollSegments(content || '_(empty)_');
  const sizeClass = SIZE_CLASS[size ?? (compact ? 'compact' : 'default')];
  return (
    <div className={sizeClass}>
      {segments.map((seg, i) =>
        seg.type === 'md' ? (
          <Md key={i} content={seg.text} />
        ) : (
          // id in the key: content edits that swap the token remount the widget
          // (fresh missing/poll/selection state); index keeps duplicates unique.
          <PollWidget key={`${i}:${seg.id}`} id={seg.id} />
        ),
      )}
    </div>
  );
}
