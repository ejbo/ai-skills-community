'use client';

// Editor node view for `codeBlock` (components/editor/code-block-extension.ts):
// the SAME dark Aceternity frame the reader shows (CODE_FRAME_CLASS +
// app/code-block.css), so writing looks like reading. Header = language picker,
// optional filename, copy; body = a line-number gutter beside ProseMirror's
// editable <pre><code>.
//
// Editing rules this view relies on:
// - The header is contentEditable={false}, and tiptap's NodeView.stopEvent
//   already hands INPUT/SELECT/BUTTON events to the browser, so typing in the
//   filename box never reaches ProseMirror; mutations outside contentDOM are
//   ignored by NodeView.ignoreMutation.
// - The filename input keeps LOCAL state and commits through updateAttributes:
//   the node prop arrives a render later, and a controlled input fed from it
//   would jump its caret to the end on every keystroke.
// - The gutter counts `textContent.split('\n')`, which includes the empty line
//   after a trailing newline — ProseMirror renders that line (trailing <br>), so
//   the numbers stay aligned. Lines never wrap (white-space: pre), so one number
//   is always one row.

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { useTranslations } from 'next-intl';
import { CODE_FRAME_CLASS, CODE_FRAME_MARGIN_CLASS, CopyCodeButton, codeGutterStyle } from '@/components/code/CodeFrame';
import { CodeBlockBase } from '@/components/editor/code-block-extension';
import { CODE_LANGUAGES, CODE_FILENAME_MAX, codeLanguageLabel, normalizeCodeFilenameInput } from '@/lib/markdown-code-lines';

export function CodeBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const t = useTranslations('ui');
  const language = (node.attrs.language as string | null) ?? '';
  const storedFilename = (node.attrs.filename as string | null) ?? '';
  const editable = editor.isEditable;

  const nodeRef = useRef(node);
  nodeRef.current = node;
  const getText = useCallback(() => nodeRef.current.textContent, []);

  const [filename, setFilename] = useState(storedFilename);
  // Adopt outside changes (undo, collaborative load) without fighting typing.
  useEffect(() => {
    setFilename((local) => (normalizeCodeFilenameInput(local) === storedFilename ? local : storedFilename));
  }, [storedFilename]);

  const text = node.textContent;
  const lineCount = text.length === 0 ? 1 : text.split('\n').length;
  let gutter = '';
  for (let i = 1; i <= lineCount; i++) gutter += i === 1 ? '1' : `\n${i}`;

  const known = CODE_LANGUAGES.some((l) => l.value === language);

  return (
    <NodeViewWrapper
      className={`${CODE_FRAME_CLASS} ${CODE_FRAME_MARGIN_CLASS}`}
      style={codeGutterStyle(lineCount)}
      data-code-block=""
      data-language={language || undefined}
    >
      <div className="code-frame-header flex items-center justify-between gap-2 pb-2 font-sans" contentEditable={false}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <select
            className="code-frame-select shrink-0"
            value={language}
            disabled={!editable}
            aria-label={t('code_language')}
            title={t('code_language')}
            onChange={(e) => updateAttributes({ language: e.target.value || null })}
          >
            <option value="">{t('code_plain_text')}</option>
            {/* A fence written by hand may use an alias (`py`, `ts`) — keep it selected and labelled. */}
            {!known && language && <option value={language}>{codeLanguageLabel(language) ?? language}</option>}
            {CODE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="code-frame-input w-full min-w-0 max-w-[16rem]"
            value={filename}
            maxLength={CODE_FILENAME_MAX}
            disabled={!editable}
            spellCheck={false}
            autoComplete="off"
            placeholder={t('code_filename_placeholder')}
            aria-label={t('code_filename_label')}
            onChange={(e) => {
              const next = normalizeCodeFilenameInput(e.target.value);
              setFilename(next);
              updateAttributes({ filename: next.trim() ? next : null });
            }}
            onKeyDown={(e) => {
              // Enter / Escape hand the caret back to the end of THIS block's code.
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                const pos = typeof getPos === 'function' ? getPos() : undefined;
                if (typeof pos === 'number') editor.chain().focus().setTextSelection(pos + nodeRef.current.nodeSize - 1).run();
                else editor.commands.focus();
              }
            }}
          />
        </div>
        <CopyCodeButton getText={getText} />
      </div>
      <div className="code-frame-body">
        <div className="code-frame-gutter" contentEditable={false} aria-hidden>
          {gutter}
        </div>
        <pre spellCheck={false}>
          <NodeViewContent as="code" className={language ? `language-${language}` : undefined} />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}

/** Register with `StarterKit.configure({ codeBlock: false })`. */
export const CodeBlockWithView = CodeBlockBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});
