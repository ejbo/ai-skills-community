import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { sanitizeSchema } from '@/lib/markdown';
import { withBasePath } from '@/lib/base-path';

// Shared code / table styling for both sizes.
const CODE_TABLE =
  'prose-pre:bg-zinc-100 prose-pre:text-zinc-800 dark:prose-pre:bg-zinc-900 dark:prose-pre:text-zinc-100 prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-zinc-800 prose-table:overflow-hidden prose-th:border prose-th:border-zinc-300 prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-zinc-200 prose-td:px-3 prose-td:py-1.5 dark:prose-th:border-zinc-700 dark:prose-td:border-zinc-800';

// Default reading size (skill description, etc.).
const DEFAULT_CLASS = `prose prose-zinc max-w-none text-[15px] leading-relaxed dark:prose-invert prose-headings:tracking-tight prose-headings:font-semibold ${CODE_TABLE}`;

// Compact size for tight panels (AI summary). Smaller body + much smaller,
// tighter headings so an h2/## doesn't dominate the panel.
const COMPACT_CLASS = `prose prose-sm prose-zinc max-w-none text-[13px] leading-relaxed dark:prose-invert prose-headings:tracking-tight prose-headings:font-semibold prose-h1:text-sm prose-h1:mb-1.5 prose-h1:mt-3 prose-h2:text-[13px] prose-h2:mb-1 prose-h2:mt-3 prose-h3:text-xs prose-h3:mb-1 prose-h3:mt-2 prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 ${CODE_TABLE}`;

export function MarkdownRenderer({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={compact ? COMPACT_CLASS : DEFAULT_CLASS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Order matters: parse raw HTML → highlight code → sanitize (last, so
        // anything the earlier plugins produced is still scrubbed against the schema).
        rehypePlugins={[
          rehypeRaw,
          [rehypeHighlight, { ignoreMissing: true, detect: false }],
          [rehypeSanitize, sanitizeSchema],
        ]}
        components={{
          // Apply the deploy basePath to root-relative media (e.g. editor-uploaded
          // images stored as "/api/uploads/...") so they resolve under subpath
          // deploys. Absolute/data/blob URLs pass through unchanged.
          img: ({ node, src, alt, ...props }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={withBasePath(typeof src === 'string' ? src : '')} alt={alt ?? ''} loading="lazy" {...props} />
          ),
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
        }}
      >
        {content || '_(empty)_'}
      </ReactMarkdown>
    </div>
  );
}
