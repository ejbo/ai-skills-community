'use client';

// 代码块外框 — the Aceternity Code Block look (ui.aceternity.com/components/code-block),
// shared by three surfaces so reading, writing and file preview look the same:
//   - MarkdownRenderer's `pre` override wraps the ALREADY highlighted,
//     already line-split `<code>` that lib/markdown-code-lines.ts produced;
//   - components/code/CodeBlock.tsx wraps raw code it highlights itself;
//   - the editor node view (components/editor/CodeBlockView.tsx) reuses
//     CODE_FRAME_CLASS + CopyCodeButton around ProseMirror's editable content.
//
// The panel is DARK IN BOTH THEMES on purpose (配色契约: a code panel is content,
// not chrome), which is also why none of this uses `dark:` variants. `not-prose`
// keeps Tailwind Typography's `pre`/`code` rules (background, padding, the
// literal backtick pseudo-elements) out of the frame; everything inside is
// styled by app/code-block.css, where the atom-dark token palette is scoped to
// `.code-frame` so the site-wide GitHub palette in globals.css still applies to
// every other highlight.js consumer.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy } from 'lucide-react';
import { codeLanguageLabel, PLAIN_CODE_LANGUAGES } from '@/lib/markdown-code-lines';

/**
 * The outer panel, without vertical margins. Exported for the editor node view,
 * whose root must be a NodeViewWrapper — and which must NOT take `first:`/`last:`
 * margin resets: tiptap wraps every React node view in its own `.react-renderer`
 * div, so the frame is always that wrapper's first AND last child and would lose
 * both margins (two code blocks in a row would touch).
 */
export const CODE_FRAME_CLASS = 'code-frame not-prose relative w-full rounded-lg bg-slate-900 p-4 font-mono text-sm';
/** In-flow spacing for a frame among prose blocks (≈16 px: the em is the frame's own 13 px text). */
export const CODE_FRAME_MARGIN_CLASS = 'my-[1.25em]';

const COPIED_MS = 2000;

/** Width of the line-number gutter in `ch`: enough digits for the last line, never under 2. */
export function codeGutterStyle(lineCount: number | null | undefined): CSSProperties {
  const digits = Math.max(2, String(Math.max(1, Math.floor(lineCount ?? 1))).length);
  return { ['--code-gutter' as string]: `${digits}ch` } as CSSProperties;
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied / insecure context — fall through to the selection-based copy.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Copy → Check for two seconds. `getText` is read at click time, so the editor
 * can hand in the live node text and the reader the DOM text.
 */
export function CopyCodeButton({ getText, className }: { getText: () => string; className?: string }) {
  const t = useTranslations('ui');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    const ok = await writeClipboard(getText());
    if (timer.current) clearTimeout(timer.current);
    setState(ok ? 'copied' : 'failed');
    timer.current = setTimeout(() => setState('idle'), COPIED_MS);
  }, [getText]);

  const label = state === 'copied' ? t('code_copied') : state === 'failed' ? t('code_copy_failed') : t('code_copy');
  return (
    <button
      type="button"
      // Keep the editor selection (and a reader's text selection) where it is.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onCopy}
      aria-label={label}
      title={label}
      data-copy-state={state}
      className={`flex shrink-0 items-center gap-1 rounded font-sans text-xs text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 ${className ?? ''}`}
    >
      {state === 'copied' ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {state === 'idle' ? '' : label}
      </span>
    </button>
  );
}

/** Header label: the filename, else the language's display name, else nothing. */
export function useCodeFrameTitle(filename?: string | null, language?: string | null): string {
  const t = useTranslations('ui');
  if (filename) return filename;
  const label = codeLanguageLabel(language);
  if (label) return label;
  return language && PLAIN_CODE_LANGUAGES.has(language.toLowerCase()) ? t('code_plain_text') : '';
}

export interface CodeFrameProps {
  /** The `<code>` element: highlighted, one `span.code-line[data-line]` per line. */
  children: ReactNode;
  language?: string | null;
  filename?: string | null;
  /** Sizes the line-number gutter. */
  lineCount?: number | null;
  /** Exact text for the copy button; when absent the rendered code's text is copied (line numbers are CSS, never in it). */
  copyText?: string;
  className?: string;
  /** Rendered inside the panel under the code (e.g. a truncation note). */
  footer?: ReactNode;
}

export function CodeFrame({ children, language, filename, lineCount, copyText, className, footer }: CodeFrameProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const title = useCodeFrameTitle(filename, language);

  const getText = useCallback(() => {
    const text = copyText ?? preRef.current?.textContent ?? '';
    // A fence always ends in a newline; nobody wants it on the clipboard.
    return text.endsWith('\n') ? text.slice(0, -1) : text;
  }, [copyText]);

  return (
    <div
      className={`${CODE_FRAME_CLASS} ${CODE_FRAME_MARGIN_CLASS} first:mt-0 last:mb-0 ${className ?? ''}`}
      data-code-frame=""
      data-language={language ?? undefined}
      style={codeGutterStyle(lineCount)}
    >
      <div className="code-frame-header flex items-center justify-between gap-3 pb-2">
        <span className="min-w-0 truncate font-sans text-xs text-zinc-400" title={filename ?? undefined}>
          {title}
        </span>
        <CopyCodeButton getText={getText} />
      </div>
      {/* tabIndex: a horizontally scrollable region must be reachable by keyboard. */}
      <pre ref={preRef} className="code-frame-pre" tabIndex={0}>
        {children}
      </pre>
      {footer}
    </div>
  );
}
