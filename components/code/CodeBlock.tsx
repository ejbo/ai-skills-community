'use client';

// Raw code → the Aceternity frame. Used for code/text attachment previews
// (components/files/FileViewer) and anywhere a component holds a string of code
// rather than rendered markdown.
//
// Rendering order: plain escaped text FIRST (instant, and the whole story for
// huge input), then highlight.js arrives through a lazy import and swaps in the
// coloured markup. The import is `@/lib/hljs-client`, NOT
// `highlight.js/lib/common`: that entry pulls the CommonJS copies of every
// grammar, which the bundler cannot share with the ESM ones rehype-highlight
// already put on any page that renders markdown (see that module). On such a
// page the lazy chunk is a few hundred bytes; on a page without markdown it is
// the grammars themselves — still loaded only when a preview opens.
//
// The language is NEVER guessed. `language` null / unknown / plain means plain
// text: highlightAuto runs every grammar synchronously on the main thread
// (~0.1–0.4 s on 20 KB) and happily calls a LICENSE "sql" or a log "bash" — the
// markdown reader turned detection off (`detect: false`) for the same reason.
// A caller that knows the language passes it; a .txt/.log does not have one.
//
// Both markups go through the same line splitter as the markdown reader
// (lib/markdown-code-lines.ts → renderCodeLinesHtml), so numbering, highlighted
// rows and the stylesheet are shared with MarkdownRenderer's frames.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CodeFrame } from '@/components/code/CodeFrame';
import { cleanCodeLanguage, escapeCodeHtml, PLAIN_CODE_LANGUAGES, renderCodeLinesHtml } from '@/lib/markdown-code-lines';

/**
 * Above this many characters the source is shown plain. highlight.js is
 * synchronous: ~200 KB of Python measured 90–150 ms plus ~80 ms of line
 * splitting and a 1.6 MB innerHTML parse, all in one main-thread task.
 */
const DEFAULT_MAX_HIGHLIGHT_CHARS = 100_000;
/**
 * Line-splitting budget for ONE preview (lib/markdown-code-lines.ts). Larger
 * than a markdown body's: this is the viewer's own browser, the text is already
 * capped by the preview's byte budget, and highlighter output is shallow — the
 * cap only has to stop a pathological input, not an ordinary long log.
 */
const CODE_BLOCK_MAX_LINE_NODES = 100_000;

type Highlighted = { key: string; html: string };

export function CodeBlock(props: {
  code: string;
  language?: string | null;
  filename?: string;
  highlightLines?: number[];
  maxHighlightChars?: number;
  className?: string;
  footer?: React.ReactNode;
}): JSX.Element {
  const { code, filename, highlightLines, className, footer } = props;
  const maxChars = props.maxHighlightChars ?? DEFAULT_MAX_HIGHLIGHT_CHARS;
  const language = cleanCodeLanguage(props.language);
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null);

  // The result is tagged with the inputs it was computed for, so a stale
  // highlight can never paint over new code while the next one is loading.
  // (Neither the language token nor the number can contain `|`, so the key is unambiguous.)
  const inputKey = `${language ?? ''}|${maxChars}|${code}`;

  useEffect(() => {
    if (!code || code.length > maxChars) return;
    if (!language || PLAIN_CODE_LANGUAGES.has(language.toLowerCase())) return;
    let cancelled = false;
    import('@/lib/hljs-client')
      .then(({ getHljs }) => {
        if (cancelled) return;
        try {
          const hljs = getHljs();
          if (!hljs.getLanguage(language)) return; // unknown grammar → stay plain
          const r = hljs.highlight(code, { language, ignoreIllegals: true });
          setHighlighted({ key: inputKey, html: r.value });
        } catch {
          // A grammar that throws leaves the plain rendering in place.
        }
      })
      .catch(() => {
        // Chunk failed to load (offline, deploy swap) — plain text is still correct.
      });
    return () => {
      cancelled = true;
    };
    // inputKey covers code/language/maxChars.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey]);

  const current = highlighted && highlighted.key === inputKey ? highlighted : null;
  // Callers commonly pass a fresh array literal; key the memo by its content.
  const hlKey = (highlightLines ?? []).join(',');

  const rendered = useMemo(
    () =>
      renderCodeLinesHtml(
        current ? current.html : escapeCodeHtml(code),
        hlKey ? hlKey.split(',').map(Number) : [],
        CODE_BLOCK_MAX_LINE_NODES,
      ),
    [current, code, hlKey],
  );
  // MEMOIZE THE OBJECT, not just the string: React diffs
  // dangerouslySetInnerHTML by identity and re-sets innerHTML whenever the
  // object is new — a literal here would rebuild every line on every re-render
  // (and lose any text selection inside it). See CLAUDE.md 知识库 ReaderContent.
  const inner = useMemo(() => ({ __html: rendered.html }), [rendered]);

  const frameFooter: ReactNode = footer ?? null;

  return (
    <CodeFrame
      language={language}
      filename={filename}
      lineCount={rendered.lineCount}
      copyText={code}
      className={className}
      footer={frameFooter}
    >
      <code className={language ? `hljs language-${language}` : 'hljs'} dangerouslySetInnerHTML={inner} />
    </CodeFrame>
  );
}
