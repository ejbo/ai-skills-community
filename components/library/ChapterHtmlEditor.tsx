'use client';

// 章节内容编辑器 — the uploader edits the chapter in the SAME processed form the
// reader sees (reader-prose typography, real headings/lists/images), not raw
// tags. A 源码 toggle keeps the plain-HTML escape hatch.
//
// Why contenteditable and not the shared RichTextEditor: RichTextEditor is the
// markdown-native editor for `*Md` fields — it pipes its value through
// markdown-it + the ProseMirror schema, which silently drops the tags the
// library sanitizer deliberately keeps (table/th/td with colspan,
// figure/figcaption, sup/sub, span, mark, <ol start>). LibraryChapter.html is
// an HTML field, so it round-trips as HTML: nothing re-parses the document
// against a schema, so nothing can be lost. The server still sanitizes on save
// (updateChapterContent → sanitizeChapterHtml), which is also what normalizes
// the <div>/bare-text soup a contenteditable emits back into <p> blocks.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Bold,
  Code2,
  Eraser,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { applyBasePathToHtml, stripBasePathFromHtml } from '@/components/library/reader/anchoring';

export type ChapterEditorMode = 'rich' | 'source';

interface Props {
  /** Stored chapter HTML (root-relative media URLs). */
  value: string;
  /** Receives stored-shape HTML (basePath stripped again). */
  onChange: (html: string) => void;
  mode: ChapterEditorMode;
}

export function ChapterHtmlEditor({ value, onChange, mode }: Props) {
  const t = useTranslations('library');
  const ref = useRef<HTMLDivElement>(null);
  const [, forceRender] = useState(0);
  // The rich surface is UNCONTROLLED after mount: re-writing innerHTML from
  // props on every keystroke would destroy the caret and the undo stack.
  const seeded = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (mode !== 'rich' || !el) return;
    if (!seeded.current) {
      el.innerHTML = applyBasePathToHtml(value);
      seeded.current = true;
    }
    try {
      // Chrome/Firefox otherwise emit <div> per Enter. The sanitizer copes
      // either way, but <p> keeps the editing surface identical to the reader.
      document.execCommand('defaultParagraphSeparator', false, 'p');
    } catch {
      /* unsupported — sanitizeChapterHtml normalizes on save */
    }
    // Re-seed when switching back from 源码 (the source textarea is the truth
    // while it is open, so its edits must land here).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Leaving rich mode resets the seed so the next entry picks up source edits.
  useEffect(() => {
    if (mode !== 'rich') seeded.current = false;
  }, [mode]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (el) onChange(stripBasePathFromHtml(el.innerHTML));
  }, [onChange]);

  const exec = useCallback(
    (command: string, arg?: string) => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      try {
        document.execCommand(command, false, arg);
      } catch {
        /* ignore — the toolbar is a convenience, typing still works */
      }
      emit();
      forceRender((n) => n + 1); // refresh the active-state ring
    },
    [emit],
  );

  const active = (command: string): boolean => {
    if (typeof document === 'undefined') return false;
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  };

  /** Delete the block the caret sits in — the common "remove this junk" edit. */
  const removeBlock = useCallback(() => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    while (node && node.parentNode !== el) node = node.parentNode;
    if (node && node !== el) {
      (node as ChildNode).remove();
      emit();
    }
  }, [emit]);

  if (mode === 'source') {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        aria-label={t('chapter_html_label')}
        className="min-h-[320px] flex-1 resize-y rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs leading-relaxed outline-none focus:border-accent-500 dark:border-zinc-800 dark:bg-zinc-900"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 bg-zinc-50/70 px-1.5 py-1 dark:border-zinc-800 dark:bg-zinc-900/50">
        <ToolButton label={t('fmt_bold')} on={active('bold')} onClick={() => exec('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_italic')} on={active('italic')} onClick={() => exec('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton label={t('fmt_paragraph')} onClick={() => exec('formatBlock', 'p')}>
          <Pilcrow className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_h2')} onClick={() => exec('formatBlock', 'h2')}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_h3')} onClick={() => exec('formatBlock', 'h3')}>
          <Heading3 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_quote')} onClick={() => exec('formatBlock', 'blockquote')}>
          <Quote className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_code')} onClick={() => exec('formatBlock', 'pre')}>
          <Code2 className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton label={t('fmt_bullets')} onClick={() => exec('insertUnorderedList')}>
          <List className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_numbers')} onClick={() => exec('insertOrderedList')}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton
          label={t('fmt_link')}
          onClick={() => {
            const url = window.prompt(t('fmt_link_prompt'));
            if (url && /^https?:\/\//i.test(url)) exec('createLink', url);
          }}
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_clear')} onClick={() => exec('removeFormat')}>
          <Eraser className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_delete_block')} onClick={removeBlock}>
          <Trash2 className="h-3.5 w-3.5" />
        </ToolButton>
        <Divider />
        <ToolButton label={t('fmt_undo')} onClick={() => exec('undo')}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolButton>
        <ToolButton label={t('fmt_redo')} onClick={() => exec('redo')}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolButton>
      </div>
      {/* The editing surface IS the reading surface: same .reader-prose rules,
          so what the uploader edits is what every reader will see. */}
      <div className="reader-root min-h-0 flex-1 overflow-y-auto" data-reader-theme="auto">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={t('chapter_content_label')}
          spellCheck={false}
          onInput={emit}
          onBlur={emit}
          onKeyUp={() => forceRender((n) => n + 1)}
          onMouseUp={() => forceRender((n) => n + 1)}
          className="reader-prose min-h-[320px] px-5 py-4 text-[15px] outline-none"
        />
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />;
}

function ToolButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on ?? undefined}
      // Keep the caret: the toolbar must never steal focus from the surface.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md transition hover:bg-zinc-200/70 dark:hover:bg-zinc-700/60 ${
        on ? 'bg-accent-500/15 text-accent-600 dark:text-accent-300' : 'text-muted'
      }`}
    >
      {children}
    </button>
  );
}
