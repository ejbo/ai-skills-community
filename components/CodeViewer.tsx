'use client';

import { useMemo } from 'react';
// `lib/common` registers ~37 common languages (same set rehype-highlight uses),
// keeping the client bundle far smaller than the full highlight.js build.
import hljs from 'highlight.js/lib/common';

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', py: 'python', rb: 'ruby', go: 'go',
  rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
  cc: 'cpp', cs: 'csharp', php: 'php', swift: 'swift', scala: 'scala', sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', json: 'json', jsonc: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', less: 'less', md: 'markdown',
  markdown: 'markdown', lua: 'lua', pl: 'perl', r: 'r', graphql: 'graphql',
  properties: 'ini', gradle: 'gradle', dockerfile: 'dockerfile', makefile: 'makefile',
};

function langFor(path: string): string | null {
  const base = (path.split('/').pop() ?? path).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot + 1) : '';
  return EXT_LANG[ext] ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function CodeViewer({ path, content }: { path: string; content: string }) {
  const html = useMemo(() => {
    const lang = langFor(path);
    if (lang && hljs.getLanguage(lang)) {
      try {
        // hljs.highlight HTML-escapes the source, so the result is safe to inject.
        return hljs.highlight(content, { language: lang }).value;
      } catch {
        /* fall through to plain escaped text */
      }
    }
    return escapeHtml(content);
  }, [path, content]);

  return (
    <pre className="overflow-auto rounded-lg bg-zinc-50 p-3 text-[12px] leading-relaxed text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <code className="hljs font-mono !bg-transparent !p-0" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
