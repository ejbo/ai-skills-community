import ReactMarkdown from 'react-markdown';

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="prose prose-zinc max-w-none text-[15px] leading-relaxed dark:prose-invert prose-headings:tracking-tight prose-headings:font-semibold prose-pre:bg-zinc-100 prose-pre:text-zinc-800 dark:prose-pre:bg-zinc-900 dark:prose-pre:text-zinc-100 prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1 prose-code:py-0.5 prose-code:text-[13px] prose-code:font-mono prose-code:before:content-none prose-code:after:content-none dark:prose-code:bg-zinc-800">
      <ReactMarkdown>{content || '_(empty)_'}</ReactMarkdown>
    </div>
  );
}
