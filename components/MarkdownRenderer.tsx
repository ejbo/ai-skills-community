import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { sanitizeSchema } from '@/lib/markdown';

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-zinc max-w-none text-[15px] leading-relaxed dark:prose-invert prose-headings:tracking-tight prose-headings:font-semibold prose-pre:bg-zinc-100 prose-pre:text-zinc-800 dark:prose-pre:bg-zinc-900 dark:prose-pre:text-zinc-100 prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-zinc-800 prose-table:overflow-hidden prose-th:border prose-th:border-zinc-300 prose-th:px-3 prose-th:py-1.5 prose-td:border prose-td:border-zinc-200 prose-td:px-3 prose-td:py-1.5 dark:prose-th:border-zinc-700 dark:prose-td:border-zinc-800">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Order matters: parse raw HTML → highlight code → sanitize (last, so
        // anything the earlier plugins produced is still scrubbed against the schema).
        rehypePlugins={[
          rehypeRaw,
          [rehypeHighlight, { ignoreMissing: true, detect: false }],
          [rehypeSanitize, sanitizeSchema],
        ]}
      >
        {content || '_(empty)_'}
      </ReactMarkdown>
    </div>
  );
}
