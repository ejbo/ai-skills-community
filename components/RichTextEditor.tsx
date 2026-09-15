'use client';

// Reusable WYSIWYG rich-text editor. Markdown in / Markdown out, so it is a
// drop-in for the app's existing `value`/`onChange` markdown textareas — the DB,
// API validation, the MarkdownRenderer pipeline and AI-assist are all unchanged.
//
// Built on Tiptap v2 + tiptap-markdown. Supports bold/italic/strike, inline
// code, text colour / background / font size / font family (one 文字样式
// popover, components/editor/TextStyleMenu.tsx), headings, lists, quote, code
// blocks with language + filename (components/editor/CodeBlockView.tsx), links,
// horizontal rule, GFM tables, undo/redo, and inline IMAGE upload (toolbar pick
// / drag-drop / paste) to /api/uploads/image.
//
// The extension list is NOT written here: components/editor/rich-text-extensions.ts
// builds it (React-free), this file only hands it the React node views, and the
// headless tests build the very same list — never copy it into a test.
//
// 技术专区 extras, all gated on `embedPicker` (decided at editor creation):
// - `[embed:<kind>:<ref>]` cards (components/zones/embeds/*) + the 插入引用 picker;
// - with `embedPicker.upload`: NON-image files dropped / pasted / picked with the
//   📎 button upload AT THE CARET through a widget-decoration placeholder
//   (file-upload-plugin.ts) and land as `[embed:file:<storage key>]`; the host
//   receives the finished draft (`onUploaded`) for its attachments ledger. A
//   `getLocal` map (saved attachments + unsaved drafts) lets the in-editor
//   card render from memory instead of asking `/api/zones/embed`.
// - `chrome="document"` (no box, sticky toolbar) + `size="article"` (the
//   reader's own prose, lib/zones/prose.ts) make the composer look like the
//   page it produces.
//
// @人 is wired here for EVERY call site (no prop, no opt-in): typing `@` opens
// components/mention/MentionPicker, and the pick lands as the stored markdown
// link contract `[@显示名](/users/<handle>)` (lib/mentions.ts) — ordinary text
// wearing the ordinary Link mark, so nothing about serialization, sanitizing or
// the other embed nodes changes.
//
// Usage:
//   <RichTextEditor value={md} onChange={setMd} placeholder="…" variant="full" />

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MutableRefObject } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { caretInTableCell, insertParagraphBesideTable, isInsideTable, pasteEscapePos, sliceHasBlockAtom } from '@/components/markdown-table';
import { beginInsertBatch, endInsertBatch, insertIntoBatch } from '@/components/editor/flow-extension';
import { ensureParagraphAt, setCaret } from '@/components/editor/flow-insert';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { unsupportedMarkdownConstructs, type MarkdownParserLike, type UnsupportedConstruct } from '@/components/editor/unsupported-markdown';
import { CodeBlockWithView } from '@/components/editor/CodeBlockView';
import { TextStyleMenu } from '@/components/editor/TextStyleMenu';
import { TOOLBAR_SHORTCUTS, ariaKeyShortcuts, formatShortcut, isApplePlatform, type ToolbarShortcut } from '@/components/editor/shortcuts';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Blocks,
  Bold,
  Italic,
  Strikethrough,
  Code,
  SquareCode,
  Columns3,
  FileUp,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Minus,
  Rows3,
  Smile,
  Table as TableIcon,
  Trash2,
  Undo2,
  Redo2,
  Loader2,
} from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { RASTER_IMAGE_EXTS, RASTER_IMAGE_MIMES, isRasterImage, uploadContentTypeFor } from '@/lib/files/file-types';
import { RICH_TEXT_RAW_CEILING_FACTOR, richTextLength } from '@/lib/markdown-text';
import { TWEEN_FAST } from '@/lib/motion';
import { ARTICLE_PROSE_CLASS } from '@/lib/zones/prose';
import { MAX_EMBEDS_PER_CONTENT, formatBytes, type EmbedKind } from '@/lib/zones/shared';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { pushToast } from '@/components/Toaster';
import { StickerPicker } from '@/components/stickers/StickerPicker';
import { MentionPicker } from '@/components/mention/MentionPicker';
import { type MentionSession } from '@/components/mention/mention-suggestion';
import { PollComposerDialog } from '@/components/polls/PollComposerDialog';
import { PollEmbedBase } from '@/components/polls/poll-embed-extension';
import { PollEmbedView } from '@/components/polls/PollEmbedView';
import {
  CONTENT_EMBED_NODE,
  ContentEmbedBase,
  insertContentEmbed,
  type ContentEmbedLocal,
  type ContentEmbedPreviewTarget,
} from '@/components/zones/embeds/embed-node-extension';
import { EmbedNodeView } from '@/components/zones/embeds/EmbedNodeView';
import { EmbedPickerDialog } from '@/components/zones/embeds/EmbedPickerDialog';
import { blockPosFor, startFileUpload } from '@/components/zones/embeds/file-upload-plugin';
import {
  MAX_BYTES,
  classify,
  clampAttachmentName,
  draftFromUpload,
  draftToView,
  uploadEndpoint,
  uploadErrorKey,
  uploadRaw,
  zoneMediaKeyFromPublicUrl,
  type AttachmentDraft,
} from '@/components/zones/attachments/upload-core';
import { usePreview } from '@/components/zones/preview/PreviewProvider';
import { richTextToneFor } from '@/lib/rich-text-ground';

export type RichTextVariant = 'full' | 'compact';

export interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  variant?: RichTextVariant;
  /** Soft character limit on the markdown string; shows a counter (no hard block). */
  maxLength?: number;
  /** Cap the editable area's height; content scrolls internally beyond it. */
  maxHeight?: number | string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** 'document': no box, no focus ring, sticky toolbar strip; default 'boxed' = the bordered field. */
  chrome?: 'boxed' | 'document';
  /** 'article' = ARTICLE_PROSE_CLASS (lib/zones/prose.ts) so the caret sits in the reader's typography. */
  size?: 'default' | 'compact' | 'article';
  /** The live tiptap Editor for hosts that insert from outside (attachments ledger 在正文插入). */
  editorRef?: MutableRefObject<Editor | null>;
  /**
   * Registers the `[embed:<kind>:<ref>]` node + a toolbar 插入引用 button
   * opening EmbedPickerDialog. Decided at editor creation — extensions are
   * wired once. Absent ⇒ every other editor is untouched.
   *
   * 技术专区 passes the post's saved attachments and, in the composer, `upload`;
   * 讨论区 passes neither and narrows `kinds` instead. The候选 search itself is
   * SITE-WIDE and viewer-gated (/api/zones/embed/search), so no zone context is
   * required to offer it elsewhere.
   */
  embedPicker?: {
    attachments?: ZoneAttachmentView[];
    /** Tabs to offer; defaults to every kind. */
    kinds?: readonly EmbedKind[];
    /** Enables 📎, non-image drop/paste, the 附件 tab's drafts + 上传, and local-first key refs. */
    upload?: {
      zoneSlug: string;
      /** Unsaved (id null) + saved drafts; keyed by key for the local map. */
      drafts?: AttachmentDraft[];
      /** Host appends via functional setState. */
      onUploaded: (draft: AttachmentDraft) => void;
      /** Feeds the host's submit gate (files uploading or queued in this editor). */
      onBusyChange?: (inFlight: number) => void;
    };
  };
}

// The block image (`image`, drag-to-resize, basePath on the displayed src,
// `<img width>` markdown) and the inline 表情包 node (`stickerImage`) live in
// components/editor/flow-image.ts — React-free, so the headless editor tests
// run the shipped serializer instead of a copy.

// In-editor 投票 embed: the shared base node (token contract + normalizer,
// components/polls/poll-embed-extension.ts) plus the React preview-card
// nodeview. Configured per editor instance with the edit callback.
const PollEmbedWithView = PollEmbedBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PollEmbedView);
  },
});

// 技术专区 embed node (components/zones/embeds/embed-node-extension.ts) +
// its preview-card nodeview. Only registered when `embedPicker` is set.
const ContentEmbedWithView = ContentEmbedBase.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EmbedNodeView);
  },
});

type ImageUploadResult = { url: string } | { error: string };

/**
 * `/api/uploads/image`. A failure used to be `null` and nothing else — a 415
 * (an svg / heic the old `image/*` test let through), a 413 or a 429 left the
 * author staring at an image that never arrived. The route's `error` code comes
 * back so the caller can toast it.
 */
async function uploadImage(file: File): Promise<ImageUploadResult> {
  try {
    const res = await fetch(withBasePath('/api/uploads/image'), {
      method: 'POST',
      headers: {
        // Declared from the extension when the OS reported no type — a real
        // `.png` with an empty `file.type` would otherwise 415.
        'content-type': uploadContentTypeFor(file),
        'x-filename': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!res.ok) {
      let code = res.status === 401 ? 'unauthenticated' : res.status === 413 ? 'file_too_large' : 'upload_failed';
      try {
        code = ((await res.json()) as { error?: string }).error || code;
      } catch {
        /* non-JSON error body */
      }
      return { error: res.status === 429 ? 'rate_limited' : code };
    }
    const data = (await res.json()) as { url?: string };
    return typeof data.url === 'string' ? { url: data.url } : { error: 'bad_response' };
  } catch {
    return { error: 'network_error' };
  }
}

/**
 * The image picker's `accept`: exactly what /api/uploads/image stores (raster),
 * by MIME and by extension (some OSes report no type for .avif / .webp). svg,
 * heic, bmp and tiff are not offered — on a 技术专区 body they go up as files
 * through 📎 instead.
 */
const IMAGE_ACCEPT = [...Array.from(RASTER_IMAGE_MIMES), ...Array.from(RASTER_IMAGE_EXTS, (e) => `.${e}`)].join(',');

const hasFiles = (dt: DataTransfer | null) => Boolean(dt && Array.from(dt.types).includes('Files'));

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  shortcut,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  /** tiptap keymap combo (components/editor/shortcuts.ts) — shown in the tooltip, announced via aria-keyshortcuts. */
  shortcut?: ToolbarShortcut;
  children: React.ReactNode;
}) {
  // Client-only: the toolbar never renders on the server (the editor is created
  // with immediatelyRender:false), so there is no hydration text to disagree with.
  const mac = isApplePlatform();
  const combo = shortcut ? TOOLBAR_SHORTCUTS[shortcut] : null;
  return (
    <button
      type="button"
      title={combo ? `${title} (${formatShortcut(combo, mac)})` : title}
      aria-label={title}
      aria-keyshortcuts={combo ? ariaKeyShortcuts(combo, mac) : undefined}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // keep editor selection
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50'
          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50'
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px self-center bg-zinc-200 dark:bg-zinc-700" />;
}

/** True when the document holds a table anywhere (tables are block-level; text is never walked). */
function docHasTable(doc: Editor['state']['doc']): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.spec.tableRole === 'table') found = true;
    return !found && !node.isTextblock && !node.isAtom;
  });
  return found;
}

/**
 * The table strip. Mounted while the DOCUMENT holds a table and merely hidden
 * (`visibility: hidden` + `inert`) while the caret is outside one: mounting it
 * on caret entry inserted a 33 px band above the document on mousedown in a cell
 * (59 px on a phone, where it wrapped to two rows), so the cell under the pointer
 * or finger jumped away and a quick second tap hit the wrong row. Its height now
 * changes only when a table is inserted or deleted, when the document reflows
 * anyway. Below `sm` it is ONE sideways-scrolling row like the main toolbar row —
 * a wrap would make its height depend on the width again.
 */
function TableToolbar({ editor, hidden }: { editor: Editor; hidden: boolean }) {
  const t = useTranslations('ui');
  const rootRef = useRef<HTMLDivElement>(null);
  // React 18 has no boolean `inert` prop; set it on the node.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (hidden) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  }, [hidden]);
  const icon = 'h-3.5 w-3.5';
  const btn =
    'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';
  return (
    <div
      ref={rootRef}
      className={`rte-toolbar-row rte-table-strip flex items-center gap-0.5 overflow-x-auto border-t border-[rgb(var(--border))] px-1.5 py-1 sm:flex-wrap sm:overflow-x-visible [&>*]:shrink-0 ${hidden ? 'invisible' : ''}`}
      role="toolbar"
      aria-label={t('rte_table_toolbar')}
      aria-hidden={hidden || undefined}
      data-hidden={hidden ? '' : undefined}
    >
      {/* A table that starts or ends the document used to leave nowhere to type
          above / below it (markdown stores no empty line). These two put a text
          line right there — reusing an empty one — and the caret on it. */}
      <button
        type="button"
        className={btn}
        title={t('rte_table_para_above_hint')}
        aria-label={t('rte_table_para_above_hint')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertParagraphBesideTable(editor, 'before')}
      >
        <ArrowUpToLine className={icon} />
        {t('rte_table_para_above')}
      </button>
      <button
        type="button"
        className={btn}
        title={t('rte_table_para_below_hint')}
        aria-label={t('rte_table_para_below_hint')}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => insertParagraphBesideTable(editor, 'after')}
      >
        <ArrowDownToLine className={icon} />
        {t('rte_table_para_below')}
      </button>
      <Divider />
      <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>
        <Rows3 className={icon} />
        {t('rte_table_add_row')}
      </button>
      <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <Columns3 className={icon} />
        {t('rte_table_add_col')}
      </button>
      <Divider />
      <button type="button" className={btn} disabled={!editor.can().deleteRow()} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>
        <Minus className={icon} />
        {t('rte_table_del_row')}
      </button>
      <button type="button" className={btn} disabled={!editor.can().deleteColumn()} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>
        <Minus className={icon} />
        {t('rte_table_del_col')}
      </button>
      <Divider />
      <button type="button" className={btn} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}>
        <Trash2 className={icon} />
        {t('rte_table_delete')}
      </button>
    </div>
  );
}

function Toolbar({
  editor,
  variant,
  uploading,
  uploadingFiles,
  disabled,
  tone,
  onPickImage,
  onPickFile,
  onOpenPoll,
  onOpenEmbed,
}: {
  editor: Editor;
  variant: RichTextVariant;
  uploading: number;
  uploadingFiles: number;
  disabled: boolean;
  /** 'reader' inside the 知识库 reader — the 文字样式 popover then wears the reader theme. */
  tone: 'default' | 'reader';
  onPickImage: () => void;
  /** 📎 上传文件 — rendered only with `embedPicker.upload`. */
  onPickFile?: () => void;
  onOpenPoll: () => void;
  /** 技术专区 插入引用 — rendered only when provided. */
  onOpenEmbed?: () => void;
}) {
  const t = useTranslations('ui');
  const icon = 'h-4 w-4';
  // Walks only when the document changed (selection-only transactions re-render with the same doc).
  const doc = editor.state.doc;
  const hasTable = useMemo(() => docHasTable(doc), [doc]);

  // 表情包 picker (portaled; the editor root is overflow-hidden, an in-place
  // absolute panel would clip). The 投票 dialog lives in RichTextEditor — the
  // in-editor poll cards need its edit mode too.
  const [stickerOpen, setStickerOpen] = useState(false);
  const stickerAnchorRef = useRef<HTMLSpanElement>(null);

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('rte_link_prompt'), prev ?? 'https://');
    if (url === null) return; // cancelled
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  // A button whose command cannot run HERE is disabled rather than left as a
  // dead click: bold / italic / strike on inline code (InlineCode excludes them
  // — components/editor/format-marks.ts), inline code over an @mention, a list
  // or heading inside a code block, a link inside code. `can()` is a dry run of
  // the very command the click would dispatch, so the two cannot disagree.
  // A FRESH dry run per check: some commands touch the transaction they are
  // handed even without dispatching (format-marks widens a selection over a
  // mention first), so one shared `can()` would leak state between checks.
  const can = () => editor.can();
  const off = (runnable: boolean) => disabled || !runnable;
  // tiptap's canSetMark answers a CARET from the marks around it and never asks
  // whether the parent block allows marks at all — so a caret inside a code
  // block (marks: '') reported bold as runnable, and the click only stored a
  // mark nothing could carry. Asked here for the inline-mark buttons.
  const caretRefuses = (mark: string) => {
    const type = editor.schema.marks[mark];
    const { selection } = editor.state;
    return Boolean(type && selection.empty && !selection.$from.parent.type.allowsMarkType(type));
  };
  const markOff = (mark: string, runnable: boolean) => off(runnable && !caretRefuses(mark));
  // Heading / list / quote / code block / rule in a table CELL: a GFM cell is
  // one line, so the table would have to be stored as raw HTML
  // (components/markdown-table.ts isGfmTable). Disabled there; the shortcuts
  // are swallowed by the table extension.
  const inCell = caretInTableCell(editor.state);
  const blockOff = (runnable: boolean) => off(runnable && !inCell);

  return (
    <div className="rte-toolbar border-b border-[rgb(var(--border))]">
      {/* Below `sm` the row SCROLLS sideways in one line instead of wrapping:
          the 技术专区 composer's 21+ buttons wrapped into three rows (97 px of
          sticky chrome above a phone keyboard). Every child is shrink-0 or the
          flex row would squeeze the 28 px buttons to their 16 px icons before
          it ever overflowed. The table strip below keeps its own row. */}
      <div className="rte-toolbar-row flex items-center gap-0.5 overflow-x-auto px-1.5 py-1 sm:flex-wrap sm:overflow-x-visible [&>*]:shrink-0">
        <ToolbarButton
          title={t('rte_bold')}
          shortcut="bold"
          active={editor.isActive('bold')}
          disabled={markOff('bold', can().toggleBold())}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className={icon} />
        </ToolbarButton>
        <ToolbarButton
          title={t('rte_italic')}
          shortcut="italic"
          active={editor.isActive('italic')}
          disabled={markOff('italic', can().toggleItalic())}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className={icon} />
        </ToolbarButton>
        <ToolbarButton
          title={t('rte_strike')}
          shortcut="strike"
          active={editor.isActive('strike')}
          disabled={markOff('strike', can().toggleStrike())}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        >
          <Strikethrough className={icon} />
        </ToolbarButton>
        {/* Inline code = `<>` (Code); the code BLOCK below is a framed square
            (SquareCode). They used to be Code vs Code2 — `<>` vs `</>`, which
            nobody could tell apart at 16 px. */}
        <ToolbarButton
          title={t('rte_inline_code')}
          shortcut="code"
          active={editor.isActive('code')}
          disabled={editor.isActive('code') ? disabled : markOff('code', can().toggleCode())}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code className={icon} />
        </ToolbarButton>
        {/* 文字样式: colour + background for every variant, 字号 / 字体 on 'full'
            (the component decides). One trigger in the ALWAYS-visible group, so
            the compact comment boxes get colour too without another row. */}
        <TextStyleMenu editor={editor} variant={variant} disabled={markOff('textColor', can().setTextColor('red'))} tone={tone} />

        {variant === 'full' && (
          <>
            <Divider />
            <ToolbarButton
              title={t('rte_h1')}
              shortcut="h1"
              active={editor.isActive('heading', { level: 1 })}
              disabled={blockOff(can().toggleHeading({ level: 1 }))}
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            >
              <Heading1 className={icon} />
            </ToolbarButton>
            <ToolbarButton
              title={t('rte_h2')}
              shortcut="h2"
              active={editor.isActive('heading', { level: 2 })}
              disabled={blockOff(can().toggleHeading({ level: 2 }))}
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            >
              <Heading2 className={icon} />
            </ToolbarButton>
            <ToolbarButton
              title={t('rte_h3')}
              shortcut="h3"
              active={editor.isActive('heading', { level: 3 })}
              disabled={blockOff(can().toggleHeading({ level: 3 }))}
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            >
              <Heading3 className={icon} />
            </ToolbarButton>
          </>
        )}

        <Divider />
        <ToolbarButton
          title={t('rte_bullet_list')}
          shortcut="bulletList"
          active={editor.isActive('bulletList')}
          disabled={blockOff(can().toggleBulletList())}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className={icon} />
        </ToolbarButton>
        <ToolbarButton
          title={t('rte_ordered_list')}
          shortcut="orderedList"
          active={editor.isActive('orderedList')}
          disabled={blockOff(can().toggleOrderedList())}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className={icon} />
        </ToolbarButton>

        {variant === 'full' && (
          <>
            <ToolbarButton
              title={t('rte_quote')}
              shortcut="blockquote"
              active={editor.isActive('blockquote')}
              disabled={blockOff(can().toggleBlockquote())}
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
            >
              <Quote className={icon} />
            </ToolbarButton>
            <ToolbarButton
              title={t('rte_code_block')}
              shortcut="codeBlock"
              active={editor.isActive('codeBlock')}
              disabled={blockOff(can().toggleCodeBlock())}
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            >
              <SquareCode className={icon} />
            </ToolbarButton>
            <ToolbarButton
              title={t('rte_table_insert')}
              active={editor.isActive('table')}
              // markdown-table.ts's insertTable refuses a table inside a table
              // (GFM cannot nest one) — `can()` is what greys the button there.
              disabled={off(can().insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
              onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            >
              <TableIcon className={icon} />
            </ToolbarButton>
          </>
        )}

        <Divider />
        <ToolbarButton
          title={t('rte_link')}
          active={editor.isActive('link')}
          // Removing a link is always possible; adding one is not inside code.
          disabled={editor.isActive('link') ? disabled : markOff('link', can().setLink({ href: 'https://example.com' }))}
          onClick={setLink}
        >
          <LinkIcon className={icon} />
        </ToolbarButton>
        <ToolbarButton title={t('rte_insert_image')} disabled={disabled || uploading > 0} onClick={onPickImage}>
          {uploading > 0 ? <Loader2 className={`${icon} animate-spin`} /> : <ImageIcon className={icon} />}
        </ToolbarButton>
        {onPickFile && (
          // Stays enabled while a file uploads — the queue sequences them.
          <ToolbarButton title={t('rte_upload_file')} disabled={disabled} onClick={onPickFile}>
            {uploadingFiles > 0 ? <Loader2 className={`${icon} animate-spin`} /> : <Paperclip className={icon} />}
          </ToolbarButton>
        )}
        <span ref={stickerAnchorRef} className="inline-flex">
          <ToolbarButton
            title={t('rte_sticker')}
            active={stickerOpen}
            disabled={disabled}
            onClick={() => setStickerOpen((o) => !o)}
          >
            <Smile className={icon} />
          </ToolbarButton>
        </span>
        <ToolbarButton title={t('rte_poll')} disabled={disabled} onClick={onOpenPoll}>
          <BarChart3 className={icon} />
        </ToolbarButton>
        {onOpenEmbed && (
          <ToolbarButton title={t('rte_embed')} disabled={disabled} onClick={onOpenEmbed}>
            <Blocks className={icon} />
          </ToolbarButton>
        )}

        {variant === 'full' && (
          <ToolbarButton
            title={t('rte_divider')}
            disabled={blockOff(can().setHorizontalRule())}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
          >
            <Minus className={icon} />
          </ToolbarButton>
        )}

        <Divider />
        <ToolbarButton title={t('rte_undo')} shortcut="undo" disabled={!can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className={icon} />
        </ToolbarButton>
        <ToolbarButton title={t('rte_redo')} shortcut="redo" disabled={!can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className={icon} />
        </ToolbarButton>

        <StickerPicker
          open={stickerOpen}
          anchor={stickerAnchorRef.current}
          onClose={() => setStickerOpen(false)}
          onSelect={(s) => {
            // Inline node: the sticker lands in the text flow at the cursor.
            editor
              .chain()
              .focus()
              .insertContent({ type: 'stickerImage', attrs: { src: s.url, alt: 'sticker' } })
              .run();
          }}
        />
      </div>
      {hasTable && <TableToolbar editor={editor} hidden={!editor.isActive('table')} />}
    </div>
  );
}

/** Local-first attachment map: saved rows by id + key, drafts by key (+ id). */
function buildLocal(embedPicker: RichTextEditorProps['embedPicker']): ContentEmbedLocal {
  const map = new Map<string, ZoneAttachmentView>();
  for (const a of embedPicker?.attachments ?? []) {
    if (a.id) map.set(a.id, a);
    const key = zoneMediaKeyFromPublicUrl(a.url);
    if (key) map.set(key, a);
  }
  for (const d of embedPicker?.upload?.drafts ?? []) {
    const v = draftToView(d);
    map.set(d.key, v);
    if (d.id) map.set(d.id, v);
  }
  return { map, zoneSlug: embedPicker?.upload?.zoneSlug ?? '' };
}

/** Embeds are always top-level blocks, so counting the doc's children is enough. */
function countEmbeds(editor: Editor): number {
  let n = 0;
  editor.state.doc.forEach((child) => {
    if (child.type.name === CONTENT_EMBED_NODE) n += 1;
  });
  return n;
}

const EMBED_COUNTER_FROM = 180;

/** Doc size (ProseMirror positions ≈ characters) above which onChange is debounced — see emitNow. */
const DEFER_EMIT_FROM = 20_000;
const EMIT_DEBOUNCE_MS = 200;

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  variant = 'full',
  maxLength,
  maxHeight,
  disabled = false,
  className,
  ariaLabel,
  autoFocus = false,
  chrome = 'boxed',
  size,
  editorRef,
  embedPicker,
}: RichTextEditorProps) {
  const tz = useTranslations('zones');
  const tu = useTranslations('ui');
  const reduce = useReducedMotion();
  const preview = usePreview();
  const [uploading, setUploading] = useState(0);
  const [uploadingFiles, setUploadingFiles] = useState(0);
  const [embedCount, setEmbedCount] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  // 技术专区 插入引用 dialog. Whether the node is registered is fixed at
  // creation (extensions are wired once), so latch the prop's presence — and
  // the same for the upload plugin.
  const [embedDialog, setEmbedDialog] = useState(false);
  const embedEnabledRef = useRef(Boolean(embedPicker));
  const uploadEnabledRef = useRef(Boolean(embedPicker?.upload));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dropLineRef = useRef<HTMLDivElement>(null);
  // Inside the 知识库 reader the page follows the READER's 浅色/护眼/深色 theme,
  // and an editor sitting directly on that ground must portal its 文字样式
  // popover into `.reader-root` and wear its variables. An editor on a site
  // `.surface` card inside the reader (DocComments in the 评论 tab) is on the
  // SITE's ground and keeps the default tone (lib/rich-text-ground.ts, mirrored
  // by app/rich-text.css). Detected from the DOM so no host threads a prop.
  const [tone, setTone] = useState<'default' | 'reader'>('default');

  // What the loaded body holds that this editor cannot keep (a README's linked
  // badges, task lists, footnotes, <details>…) — told BEFORE the author edits,
  // not discovered after the save dropped it (components/editor/unsupported-markdown.ts).
  const locale = useLocale();
  const [unsupported, setUnsupported] = useState<UnsupportedConstruct[]>([]);
  const scanUnsupported = useCallback((ed: Editor, markdown: string) => {
    const md = (ed.storage as { markdown?: { parser?: { md?: MarkdownParserLike } } }).markdown?.parser?.md;
    const next = md ? unsupportedMarkdownConstructs(md, markdown) : [];
    setUnsupported((prev) => (prev.join() === next.join() ? prev : next));
  }, []);

  // Latest host callbacks / lookups, read through refs by the (once-wired) extensions.
  const uploadRef = useRef(embedPicker?.upload);
  uploadRef.current = embedPicker?.upload;
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const localRef = useRef<ContentEmbedLocal>({ map: new Map(), zoneSlug: '' });
  localRef.current = buildLocal(embedPicker);
  const embedCountRef = useRef(0);

  // 投票 dialog — hosted here (not in Toolbar) because the in-editor poll
  // cards' 编辑 buttons open it too, via a ref-backed callback handed to the
  // PollEmbed extension (extensions are wired once at editor creation).
  const [pollDialog, setPollDialog] = useState<{ open: boolean; pollId: string | null }>({
    open: false,
    pollId: null,
  });
  const openPollEditRef = useRef<(pollId: string) => void>(() => {});
  useEffect(() => {
    openPollEditRef.current = (pollId) => setPollDialog({ open: true, pollId });
  }, []);

  // @人 — the suggestion plugin publishes the live `@…` session here and asks
  // `mentionKeyRef` whether the popup swallowed a key. Both are ref/stable-setter
  // backed because the extension list is wired once, at editor creation.
  const [mention, setMention] = useState<MentionSession | null>(null);
  const mentionKeyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);

  // Keep the latest onChange without re-creating the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ── Emitting markdown (onChange) ────────────────────────────────────────────
  // Serializing the WHOLE document is superlinear in its size (prosemirror-markdown
  // + tiptap-markdown: ~20 ms at 100 KB, ~95 ms at 195 KB), and it used to run
  // TWICE per keystroke — once here, and once more in the controlled sync below,
  // which re-serialized just to discover that the new `value` was its own echo.
  // Typing in a long 技术专区 post blocked for 200+ ms per key, well under the
  // 200 000-character cap. Now:
  // - the markdown emitted is remembered as the synced value, so the echo is
  //   recognised by string comparison and never re-serialized;
  // - above DEFER_EMIT_FROM (doc size) the emit is a trailing debounce, flushed
  //   on blur (a click on 发布 blurs the editor before its click handler runs),
  //   before an external `value` is compared, and on unmount. Comment boxes
  //   (a few thousand characters at most) stay exactly per-keystroke.
  // `syncedRef` is declared here, before useEditor, because onUpdate writes it.
  const syncedRef = useRef<{ editor: Editor; value: string } | null>(null);
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emitNow = useCallback((ed: Editor) => {
    if (emitTimerRef.current) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    }
    let markdown: string;
    try {
      markdown = ed.storage.markdown.getMarkdown();
    } catch {
      return; // a destroyed view mid-unmount: nothing left to report
    }
    if (syncedRef.current?.editor === ed) syncedRef.current.value = markdown;
    onChangeRef.current(markdown);
  }, []);

  // Insert closures, ref-backed so the (once-created) editorProps paste/drop
  // handlers always call the live version (set in an effect once the editor
  // exists). Declared before useEditor so the handlers can reference them.
  const insertImagesRef = useRef<(files: File[], pos?: number) => void>(() => {});
  const insertFilesRef = useRef<(files: File[], pos?: number) => void>(() => {});
  const routeFilesRef = useRef<(files: File[], pos?: number) => void>(() => {});

  // Placeholder copy for the upload plugin — strings only, wired at creation.
  const uploadLabels = useMemo(
    () => ({
      uploading: tz('attach_upload_uploading'),
      queued: tz('attach_upload_queued'),
      failed: tz('attach_upload_failed_inline'),
      cancel: tz('attach_upload_cancel'),
      retry: tz('attach_upload_retry'),
      aria: (name: string) => tz('attach_uploading_in_body', { name }),
    }),
    [tz],
  );
  const uploadLabelsRef = useRef(uploadLabels);
  uploadLabelsRef.current = uploadLabels;

  const article = size === 'article';
  const proseClass = article
    ? ARTICLE_PROSE_CLASS
    : (size ?? (variant === 'compact' ? 'compact' : 'default')) === 'compact'
      ? 'prose prose-sm prose-zinc max-w-none dark:prose-invert'
      : 'prose prose-zinc max-w-none dark:prose-invert';
  const contentBox = chrome === 'document' ? 'min-h-[60vh] py-4' : `${variant === 'compact' ? 'min-h-[4.5rem]' : 'min-h-[9rem]'} px-3 py-2`;

  const editor = useEditor({
    immediatelyRender: false, // SSR-safe for Next App Router
    autofocus: autoFocus ? 'end' : false,
    editable: !disabled,
    // The shared list (components/editor/rich-text-extensions.ts) — the same
    // one the headless tests build — with this editor's React node views and
    // callbacks. Whether the embed node and the upload placeholders exist is
    // decided once, here: extensions are wired at creation.
    extensions: buildRichTextExtensions({
      placeholder: placeholder ?? '',
      mention: {
        onSession: setMention,
        onKeyDown: (event) => mentionKeyRef.current(event),
      },
      poll: { onEdit: (id: string) => openPollEditRef.current(id) },
      embed: embedEnabledRef.current
        ? {
            getLocal: () => localRef.current,
            onPreview: (target: ContentEmbedPreviewTarget) =>
              previewRef.current.open({ kind: target.kind, ref: target.ref, title: target.title, data: target.data, via: target.via }),
          }
        : false,
      upload: uploadEnabledRef.current ? { labels: uploadLabelsRef.current } : false,
      views: { codeBlock: CodeBlockWithView, pollEmbed: PollEmbedWithView, contentEmbed: ContentEmbedWithView },
    }),
    content: value,
    editorProps: {
      attributes: {
        class: `rte-content ${proseClass} ${contentBox} focus:outline-none`,
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handlePaste: (view, event, slice) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) {
          // Not a file paste — but the slice ProseMirror is about to drop in has
          // already been parsed, so a markdown `![x](…)` pasted as TEXT is a
          // BLOCK image by now and would land inside a table cell (the whole
          // table then serializes as raw HTML — components/markdown-table.ts).
          // Land it after the table instead, the same lift the caret rule does.
          const escape = pasteEscapePos(view.state, slice);
          if (escape != null) {
            try {
              const tr = view.state.tr.insert(escape, slice.content);
              // …and the caret follows it out of the cell, onto the line after.
              setCaret(tr, ensureParagraphAt(tr, escape + slice.content.size));
              view.dispatch(tr.scrollIntoView().setMeta('paste', true));
              return true;
            } catch {
              return false; // an open slice that will not fit at depth 0 — let ProseMirror paste it
            }
          }
          return false; // let tiptap-markdown handle pasted text
        }
        // A file paste that carries nothing this editor can take (a copied .py
        // in a comment box) but DOES carry text — Finder / Explorer put the file
        // name there — keeps pasting that text, as it always did.
        if (!uploadEnabledRef.current && !files.some(isRasterImage)) {
          const cd = event.clipboardData;
          if (cd?.getData('text/plain') || cd?.getData('text/html')) return false;
        }
        event.preventDefault();
        routeFilesRef.current(files, view.state.selection.to);
        return true;
      },
      handleDrop: (view, event, slice, moved) => {
        if (moved) {
          // An atom (image / embed / poll card) dragged INTO a table cell is a
          // document markdown cannot say: the whole table would be stored as raw
          // HTML and an embed inside a cell is no longer an own-line token, so
          // the reader never resolves it. Refuse that one move (the card stays
          // where it was); every other in-editor drag is ProseMirror's.
          const drop = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
          return drop != null && sliceHasBlockAtom(slice) && isInsideTable(view.state, drop.pos);
        }
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        // Always taken once files are dropped: returning false here let the
        // browser's default drop run, which OPENS the file in place of the page
        // (a .pdf dropped on a comment box navigated away from the draft).
        event.preventDefault();
        // Every kind lands where it was DROPPED, not wherever the caret is when
        // the upload finishes.
        const hit = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
        routeFilesRef.current(files, hit?.pos ?? view.state.selection.to);
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (editor.state.doc.content.size > DEFER_EMIT_FROM) {
        if (emitTimerRef.current) clearTimeout(emitTimerRef.current);
        emitTimerRef.current = setTimeout(() => emitNow(editor), EMIT_DEBOUNCE_MS);
      } else {
        emitNow(editor);
      }
      if (embedEnabledRef.current) {
        const n = countEmbeds(editor);
        if (n !== embedCountRef.current) {
          embedCountRef.current = n;
          setEmbedCount(n);
        }
      }
    },
    onBlur: ({ editor }) => {
      if (emitTimerRef.current) emitNow(editor);
    },
  });

  // A deferred emit must not be lost when the editor goes away.
  useEffect(
    () => () => {
      if (editor && emitTimerRef.current) emitNow(editor);
    },
    [editor, emitNow],
  );

  // rootRef is attached on the first render WITH an editor (before that the
  // placeholder div renders), hence the dependency.
  useEffect(() => {
    if (!editor) return;
    setTone(richTextToneFor(rootRef.current));
  }, [editor]);

  // Hand the live editor to the host (在正文插入 from the ledger).
  useEffect(() => {
    if (editorRef) editorRef.current = editor ?? null;
  }, [editor, editorRef]);

  // Wire the live insert-images implementation (needs the created editor).
  // One BATCH per pick / paste / drop (components/editor/flow-extension.ts):
  // uploads run in parallel and each finished image lands at the batch's
  // mapped position — after the images before it, in completion order — with
  // the caret on the line below while the author has not moved it. The old
  // per-file `setImage` inserted at the selection, which after the first image
  // was a NodeSelection ON that image: every later upload replaced it, and
  // picking three images at the end of a post kept one. The shared placement
  // rule also keeps images out of table cells (a GFM cell is inline-only).
  //
  // Only RASTER images come here (isRasterImage — the set the route
  // stores); a failed upload toasts the route's reason instead of vanishing.
  useEffect(() => {
    insertImagesRef.current = (files: File[], pos?: number) => {
      if (!editor || editor.isDestroyed) return;
      const images = files.filter(isRasterImage);
      if (images.length === 0) return;
      const view = editor.view;
      const batch = beginInsertBatch(view, pos);
      let pending = images.length;
      for (const file of images) {
        setUploading((n) => n + 1);
        void uploadImage(file)
          .then((result) => {
            if (editor.isDestroyed) return;
            if ('error' in result) {
              const name = clampAttachmentName(file.name);
              pushToast('error', tz('attach_upload_error', { name, error: tz(uploadErrorKey(new Error(result.error))) }));
              return;
            }
            const node = editor.schema.nodes.image.create({ src: result.url, alt: file.name.replace(/\.[^.]+$/, '') });
            insertIntoBatch(view, batch, node);
          })
          .finally(() => {
            setUploading((n) => n - 1);
            pending -= 1;
            if (pending === 0 && !editor.isDestroyed) endInsertBatch(view, batch);
          });
      }
    };
  }, [editor, tz]);

  // Non-image files → placeholder at the caret block, sequential upload queue
  // (file-upload-plugin.ts). EVERY file type is attachable (lib/files/file-types.ts
  // decides image / video / file by extension, MIME only as a hint); the byte
  // caps are checked here first and again by the server. Raster images that
  // arrive via 📎 still take the inline-image path.
  useEffect(() => {
    insertFilesRef.current = (files, pos) => {
      if (!editor || !uploadEnabledRef.current) return;
      const view = editor.view;
      const at = pos ?? view.state.selection.to;
      const images = files.filter(isRasterImage);
      if (images.length > 0) insertImagesRef.current(images, at);
      // ONE insert batch for the pick's files (file-upload-plugin.ts): the cards
      // stack under each other without blank lines and the caret follows them
      // while the author has not moved it. The plugin ends the batch once the
      // last file settles — a batch whose files were all refused below is ended
      // right here.
      const batch = beginInsertBatch(view, at);
      let started = 0;
      for (const file of files) {
        if (isRasterImage(file)) continue;
        const kind = classify(file);
        const name = clampAttachmentName(file.name);
        if (file.size > MAX_BYTES[kind]) {
          pushToast('error', tz('attach_too_large', { name, max: formatBytes(MAX_BYTES[kind]) }));
          continue;
        }
        started += 1;
        startFileUpload(view, file, at, {
          upload: (f, onProgress, signal) =>
            uploadRaw(f, uploadEndpoint(uploadRef.current?.zoneSlug ?? ''), { 'x-upload-kind': kind }, onProgress, signal).then((r) => ({
              key: r.key,
              draft: draftFromUpload(f, kind, r, name),
            })),
          onDone: (draft) => uploadRef.current?.onUploaded(draft),
          onError: (_f, e) => pushToast('error', tz('attach_upload_error', { name, error: tz(uploadErrorKey(e)) })),
          onBusy: (busy) => setUploadingFiles((n) => Math.max(0, n + (busy ? 1 : -1))),
        }, { batch });
      }
      if (started === 0) endInsertBatch(view, batch);
    };
  }, [editor, tz]);

  // ONE router for files arriving by paste, drop or either picker: raster images
  // go inline, everything else goes up as a body attachment where this editor
  // has one (技术专区) — and where it does not (comments, 讨论区, 活动…), the
  // author is told the file was not inserted instead of nothing happening.
  useEffect(() => {
    routeFilesRef.current = (files, pos) => {
      if (!editor || editor.isDestroyed || files.length === 0) return;
      if (uploadEnabledRef.current) {
        insertFilesRef.current(files, pos);
        return;
      }
      const images = files.filter(isRasterImage);
      if (images.length > 0) insertImagesRef.current(images, pos);
      const rest = files.filter((f) => !isRasterImage(f));
      if (rest.length > 0) {
        pushToast('error', tu('rte_image_only', { names: rest.map((f) => clampAttachmentName(f.name, 60)).join(', ') }));
      }
    };
  }, [editor, tu]);

  // Report in-flight body uploads to the host's submit gate.
  const onBusyChange = embedPicker?.upload?.onBusyChange;
  const onBusyChangeRef = useRef(onBusyChange);
  onBusyChangeRef.current = onBusyChange;
  useEffect(() => {
    onBusyChangeRef.current?.(uploadingFiles);
  }, [uploadingFiles]);
  useEffect(() => () => onBusyChangeRef.current?.(0), []);

  // Controlled sync: when `value` changes externally (AI-assist fill, form reset)
  // and differs from the editor's current markdown, replace the content without
  // emitting an update (so we don't fight the user's keystrokes / move the cursor).
  //
  // NOT on the first run for an editor instance: the editor was just created
  // FROM this `value`. Comparing there is wrong — the poll / embed normalizers
  // have not turned `[embed:…]` / `[poll:…]` paragraphs into cards yet (a
  // microtask), so the markdown never matches, and the resulting setContent is
  // an UNDOABLE step: Undo on a pristine post opened for editing turned every
  // card back into raw token text (live repro on /zones/…/posts/…/edit).
  //
  // `syncedRef` (declared with emitNow) holds the last value exchanged with the
  // host in EITHER direction: an echo of what the editor emitted returns below
  // without serializing anything.
  useEffect(() => {
    if (!editor) return;
    if (syncedRef.current?.editor !== editor) {
      // The markdown this instance was created from: tiptap-markdown keeps it on
      // `options.initialContent` until its (async) create hook puts it back on
      // `options.content`. A `value` that moved on in between still syncs below.
      const opts = editor.options as { content?: unknown; initialContent?: unknown };
      const createdFrom = typeof opts.initialContent === 'string' ? opts.initialContent : opts.content;
      syncedRef.current = { editor, value: typeof createdFrom === 'string' ? createdFrom : value };
      scanUnsupported(editor, syncedRef.current.value);
      if (embedEnabledRef.current) {
        // After the normalizer's own load microtask (queued at view creation).
        queueMicrotask(() => {
          if (editor.isDestroyed) return;
          const n = countEmbeds(editor);
          embedCountRef.current = n;
          setEmbedCount(n);
        });
      }
    }
    if (syncedRef.current.value === value) return;
    // A new value from OUTSIDE (AI fill, 恢复, reset): it replaces the content,
    // so a deferred emit of the edits it replaces is dropped — flushing it would
    // hand the host the old text and overwrite the value it just set.
    if (emitTimerRef.current) {
      clearTimeout(emitTimerRef.current);
      emitTimerRef.current = null;
    }
    syncedRef.current.value = value;
    const current = editor.storage.markdown.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value || '', false);
      scanUnsupported(editor, value);
      if (embedEnabledRef.current) {
        const n = countEmbeds(editor);
        embedCountRef.current = n;
        setEmbedCount(n);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  // emitUpdate=false: tiptap's setEditable emits `update` by default, which
  // re-serialized the untouched content into onChange on MOUNT and made every
  // pristine composer "dirty" (autosave + a 恢复 banner on the next visit).
  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  const onPickImage = useCallback(() => fileInputRef.current?.click(), []);
  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    // Through the router, not straight to the image path: the OS dialog's
    // "All files" option lets anything past `accept`.
    routeFilesRef.current(Array.from(e.target.files ?? []));
    e.target.value = ''; // allow re-selecting the same file
  }, []);
  const onPickFile = useCallback(() => uploadInputRef.current?.click(), []);
  const onUploadChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) insertFilesRef.current(files);
    e.target.value = '';
  }, []);

  // ── Drag affordance (upload editors only): a COUNTER on the root — dragenter /
  // dragleave fire for every child crossed, a boolean would flicker — drives the
  // dashed overlay, and a rAF-throttled dragover positions the 2 px drop line at
  // the block boundary the file will land on. The DOM is written directly (no
  // React state per move). Drops on the toolbar (outside ProseMirror) are caught
  // here so the browser never navigates to the file.
  const dragDepth = useRef(0);
  const dragRaf = useRef(0);
  const dropPosRef = useRef<number | null>(null);

  const hideLine = useCallback(() => {
    if (dragRaf.current) cancelAnimationFrame(dragRaf.current);
    dragRaf.current = 0;
    dropPosRef.current = null;
    if (dropLineRef.current) dropLineRef.current.style.display = 'none';
  }, []);
  const endDrag = useCallback(() => {
    dragDepth.current = 0;
    setDragOver(false);
    hideLine();
  }, [hideLine]);
  useEffect(() => () => hideLine(), [hideLine]);

  const onRootDragEnter = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!uploadEnabledRef.current || disabled || !hasFiles(e.dataTransfer)) return;
    dragDepth.current += 1;
    if (dragDepth.current === 1) setDragOver(true);
  };
  const onRootDragLeave = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!uploadEnabledRef.current || !hasFiles(e.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) endDrag();
  };
  const onRootDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!uploadEnabledRef.current || disabled || !editor || !hasFiles(e.dataTransfer)) return;
    e.preventDefault(); // allow the drop everywhere inside the root (toolbar included)
    const { clientX: x, clientY: y } = e;
    if (dragRaf.current) return;
    dragRaf.current = requestAnimationFrame(() => {
      dragRaf.current = 0;
      const root = rootRef.current;
      const line = dropLineRef.current;
      if (!root || !line || editor.isDestroyed) return;
      const view = editor.view;
      const hit = view.posAtCoords({ left: x, top: y });
      const pos = blockPosFor(view.state, hit?.pos ?? view.state.doc.content.size);
      dropPosRef.current = pos;
      let top: number;
      try {
        top = view.coordsAtPos(pos).top;
      } catch {
        return;
      }
      line.style.top = `${Math.round(top - root.getBoundingClientRect().top)}px`;
      line.style.display = 'block';
    });
  };
  const onRootDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const pos = dropPosRef.current;
    endDrag();
    if (e.defaultPrevented) return; // ProseMirror's handleDrop took it
    if (!uploadEnabledRef.current || disabled || !hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    insertFilesRef.current(Array.from(e.dataTransfer.files), pos ?? undefined);
  };

  // The counter and the over-limit colour count VISIBLE text (lib/markdown-text.ts):
  // colouring a phrase adds ~30 raw characters of `<span data-color>` markup,
  // and the server's caps (lib/rich-text-limit.ts) discount exactly that — a raw
  // `value.length` here would turn red on a comment the server accepts.
  // ONE scan per distinct `value`, never per render: the editor re-renders on
  // every transaction (tiptap's default — the toolbar's active states need it),
  // caret moves included, and the old inline pair scanned a long article twice
  // each time. Same gate as isRichTextTooLong (lib/markdown-text.ts): visible
  // length never exceeds raw length, so `visible > limit` already implies it.
  const { visibleLength, over } = useMemo(() => {
    if (maxLength == null) return { visibleLength: 0, over: false };
    const visible = richTextLength(value);
    return { visibleLength: visible, over: value.length > maxLength * RICH_TEXT_RAW_CEILING_FACTOR || visible > maxLength };
  }, [value, maxLength]);
  const uploadOn = embedEnabledRef.current && uploadEnabledRef.current && Boolean(embedPicker?.upload);
  const rootCls = `rte relative ${chrome === 'document' ? 'rte-document' : 'surface overflow-hidden rounded-lg'} ${article ? 'rte-article' : ''} ${
    disabled ? 'opacity-60' : ''
  } ${className ?? ''}`;

  if (!editor) {
    // First server render / pre-hydration placeholder (keeps layout stable).
    return (
      <div
        className={`${chrome === 'document' ? 'min-h-[60vh]' : `surface rounded-lg ${variant === 'compact' ? 'min-h-[6.5rem]' : 'min-h-[11rem]'}`} ${className ?? ''}`}
        aria-busy
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={rootCls}
      onDragEnter={uploadOn ? onRootDragEnter : undefined}
      onDragLeave={uploadOn ? onRootDragLeave : undefined}
      onDragOver={uploadOn ? onRootDragOver : undefined}
      onDrop={uploadOn ? onRootDrop : undefined}
      onDragEnd={uploadOn ? endDrag : undefined}
    >
      <Toolbar
        editor={editor}
        variant={variant}
        uploading={uploading}
        uploadingFiles={uploadingFiles}
        disabled={disabled}
        tone={tone}
        onPickImage={onPickImage}
        onPickFile={uploadOn ? onPickFile : undefined}
        onOpenPoll={() => setPollDialog({ open: true, pollId: null })}
        onOpenEmbed={embedPicker && embedEnabledRef.current ? () => setEmbedDialog(true) : undefined}
      />
      {unsupported.length > 0 && (
        <div role="status" className="flex items-start gap-2 border-b border-[rgb(var(--border))] px-3 py-1.5 text-[12px] leading-5 text-muted">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">
            {tu('rte_unsupported_notice', {
              list: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(unsupported.map((k) => tu(`rte_unsupported_${k}`))),
            })}
          </span>
          <button
            type="button"
            onClick={() => setUnsupported([])}
            className="shrink-0 rounded px-1 font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-200"
          >
            {tu('rte_unsupported_dismiss')}
          </button>
        </div>
      )}
      <EditorContent editor={editor} style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined} />
      {/* @人 — portals itself; renders nothing until an `@…` session is live. */}
      <MentionPicker session={mention} keyRef={mentionKeyRef} />
      <input ref={fileInputRef} type="file" accept={IMAGE_ACCEPT} multiple hidden onChange={onFileChange} />
      {uploadOn && (
        // No `accept`: any file type is an attachment now (owner decision
        // 2026-09; lib/files/file-types.ts classifies by extension).
        <input ref={uploadInputRef} type="file" multiple hidden onChange={onUploadChange} />
      )}
      {uploadOn && (
        <>
          {/* M18: the 2 px drop line — positioned by the dragover handler, never by React state. */}
          <div
            ref={dropLineRef}
            aria-hidden
            style={{ display: 'none' }}
            className="pointer-events-none absolute inset-x-3 z-[2] h-0.5 rounded bg-zinc-900 transition-[top] duration-[60ms] dark:bg-zinc-100"
          />
          <AnimatePresence>
            {dragOver && (
              <motion.div
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={reduce ? { duration: 0 } : TWEEN_FAST}
                className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-900 bg-white/70 text-sm font-medium text-zinc-900 dark:border-zinc-100 dark:bg-zinc-950/70 dark:text-zinc-100"
              >
                <FileUp className="h-5 w-5" />
                {tu('rte_drop_files')}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      <PollComposerDialog
        open={pollDialog.open}
        pollId={pollDialog.pollId}
        onClose={() => setPollDialog({ open: false, pollId: null })}
        onCreated={(pollId) => {
          // Insert the embed node at the document TOP LEVEL: at the selection,
          // a caret inside a blockquote/list would nest it and the own-line
          // token contract (lib/polls-shared.ts) would never match on render.
          const { $to } = editor.state.selection;
          const pos = $to.depth === 0 ? $to.pos : $to.after(1);
          editor
            .chain()
            .focus()
            .insertContentAt(pos, [
              { type: 'pollEmbed', attrs: { pollId } },
              { type: 'paragraph' },
            ])
            .run();
        }}
      />
      {embedPicker && embedEnabledRef.current && (
        <EmbedPickerDialog
          open={embedDialog}
          onClose={() => setEmbedDialog(false)}
          kinds={embedPicker.kinds}
          attachments={embedPicker.attachments}
          drafts={embedPicker.upload?.drafts}
          onUpload={uploadOn ? onPickFile : undefined}
          // Same top-level insertion rule as the poll node (see insertContentEmbed).
          onPick={(kind, ref) => insertContentEmbed(editor, kind, ref)}
        />
      )}
      {(maxLength != null || embedCount > EMBED_COUNTER_FROM) && (
        <div className="flex items-center justify-end gap-3 px-3 pb-1.5 text-right text-[11px] text-muted">
          {embedCount > EMBED_COUNTER_FROM && (
            <span className={embedCount > MAX_EMBEDS_PER_CONTENT ? 'text-danger' : undefined}>
              {tu('rte_embed_count', { count: embedCount, max: MAX_EMBEDS_PER_CONTENT })}
            </span>
          )}
          {maxLength != null && (
            <span className={over ? 'text-danger' : undefined}>
              {visibleLength} / {maxLength}
            </span>
          )}
        </div>
      )}

      <style jsx global>{`
        .rte:focus-within {
          border-color: rgb(var(--accent));
          box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
        }
        .rte:not(.rte-article) .rte-content {
          font-size: ${variant === 'compact' ? '0.8125rem' : '0.9375rem'};
        }
        /* Document chrome: the page IS the editor — no box, no ring, a toolbar
           strip that sticks under the composer's 3 rem top bar. */
        /* The toolbar row scrolls sideways below sm (Toolbar): no scrollbar
           strip under the buttons — the half-visible button at the edge is
           the cue that there is more. */
        .rte .rte-toolbar-row {
          scrollbar-width: none;
        }
        .rte .rte-toolbar-row::-webkit-scrollbar {
          display: none;
        }
        .rte-document {
          border: 0;
          box-shadow: none;
          background: transparent;
        }
        .rte-document:focus-within {
          box-shadow: none;
          border-color: transparent;
        }
        .rte-document .rte-toolbar {
          position: sticky;
          top: 3rem;
          z-index: 20;
          background: rgb(var(--bg));
        }
        .rte-document .rte-content {
          min-height: 60vh;
          padding-left: 0;
          padding-right: 0;
        }
        .rte .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
          color: rgb(var(--text-muted));
        }
        .rte .ProseMirror img {
          max-width: 100%;
          height: auto;
          border-radius: 0.5rem;
        }
        .rte .rte-img {
          position: relative;
          display: inline-block;
          max-width: 100%;
          line-height: 0;
        }
        /* A BLOCK image's wrapper (flow-image.ts) is exactly the picture's box:
           a block that hugs the image, with the prose margins moved OUTSIDE it.
           They used to sit on the <img> inside an inline-block wrapper, so the
           2 em below a trailing image belonged to the image — a click "just
           below" re-selected it, the next key replaced it, and the resize dot
           floated 34 px under the corner. */
        .rte .rte-img.rte-img-block {
          display: block;
          width: fit-content;
          margin: 2em 0;
        }
        .rte .prose-sm .rte-img.rte-img-block {
          margin: 1.7142857em 0;
        }
        .rte .rte-img.rte-img-block > img {
          margin: 0;
        }
        .rte .ProseMirror > .rte-img.rte-img-block:first-child {
          margin-top: 0;
        }
        /* The gap cursor: the caret ProseMirror shows where no text line exists
           (before a table / image / card that opens the document, between two
           cards). tiptap's default is a 20 px x 1 px BLACK dash drawn on top of
           the neighbouring block's border — unseen in light, gone in dark. A
           full-width 2 px line in the text colour, blinking like the caret it
           stands in for; still under reduced motion. */
        .rte .ProseMirror-gapcursor {
          left: 0.75rem;
          right: 0.75rem;
        }
        .rte-document .ProseMirror-gapcursor {
          left: 0;
          right: 0;
        }
        .rte .ProseMirror-gapcursor::after {
          width: 100%;
          top: -4px;
          border-top: 2px solid rgb(var(--text));
          border-radius: 1px;
        }
        @media (prefers-reduced-motion: reduce) {
          .rte .ProseMirror-gapcursor::after {
            animation: none;
          }
        }
        .rte .rte-img.is-selected img,
        .rte .ProseMirror img.ProseMirror-selectednode {
          outline: 2px solid rgb(var(--accent));
        }
        .rte .rte-img.rte-sticker img {
          width: 6rem;
          height: 6rem;
          object-fit: contain;
        }
        .rte [data-poll-embed].ProseMirror-selectednode .pe-card,
        .rte .ProseMirror-selectednode[data-poll-embed] {
          outline: 2px solid rgb(var(--accent));
          border-radius: 0.875rem;
        }
        .rte .ProseMirror-selectednode[data-content-embed],
        .rte [data-content-embed].ProseMirror-selectednode .ce-card {
          outline: 2px solid rgb(var(--text) / 0.6);
          border-radius: 0.875rem;
        }
        .rte .rte-img-handle {
          display: none;
          position: absolute;
          right: -6px;
          bottom: -6px;
          height: 12px;
          width: 12px;
          border-radius: 9999px;
          border: 2px solid white;
          background: rgb(var(--accent));
          cursor: nwse-resize;
        }
        .rte .rte-img.is-selected .rte-img-handle {
          display: block;
        }
        .rte .ProseMirror a {
          color: rgb(var(--accent));
          text-decoration: underline;
        }
        /* @人 — the SAME ink chip the reader paints (components/mention/chip.ts),
           so the composer shows what the post will look like. The selector is
           the stored href: the doc keeps mentions root-relative (only the image
           node applies withBasePath), so it matches under /ai-community too. */
        .rte .ProseMirror a[href^='/users/'] {
          color: inherit;
          text-decoration: none;
          font-weight: 500;
          /* Same geometry as MENTION_CHIP_CLASS (px-1 / -mx-0.5) so the chip is
             the same size in the composer as on the page. */
          border-radius: 0.25rem;
          padding: 0 0.25rem;
          margin: 0 -0.125rem;
          background: rgb(113 113 122 / 0.1);
        }
        /* The live @查询 decoration, so it is visible which text is matching. */
        .rte .rte-mention-query {
          border-radius: 0.25rem;
          background: rgb(var(--text) / 0.06);
        }
        /* GFM tables — hairline ink grid, header row on zinc-100 / zinc-800. */
        .rte .ProseMirror .tableWrapper {
          overflow-x: auto;
          margin: 1em 0;
        }
        .rte .ProseMirror table {
          border-collapse: collapse;
          width: 100%;
          table-layout: fixed;
          margin: 0;
        }
        .rte .ProseMirror th,
        .rte .ProseMirror td {
          position: relative;
          min-width: 3rem;
          border: 1px solid rgb(var(--border));
          padding: 0.375rem 0.625rem;
          vertical-align: top;
          text-align: left;
        }
        .rte .ProseMirror th {
          background: rgb(244 244 245);
          font-weight: 600;
        }
        [data-theme='dark'] .rte .ProseMirror th {
          background: rgb(39 39 42);
        }
        .rte .ProseMirror th > p,
        .rte .ProseMirror td > p {
          margin: 0;
        }
        .rte .ProseMirror .selectedCell::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: rgb(var(--text) / 0.08);
        }
        /* Upload placeholder widget (file-upload-plugin.ts) — the EmbedCard
           loading shell: hairline card, 1 px progress bar filled by --p. */
        .rte .rte-upload {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin: 0.5rem 0;
          border: 1px solid rgb(var(--border));
          border-radius: 0.75rem;
          padding: 0.625rem 0.75rem;
          background: rgb(var(--surface));
          color: rgb(var(--text));
          font-size: 0.8125rem;
          line-height: 1.25rem;
          user-select: none;
        }
        .rte .rte-upload-icon {
          display: inline-flex;
          flex-shrink: 0;
          color: rgb(var(--text-muted));
        }
        .rte .rte-upload-name {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 500;
        }
        .rte .rte-upload-size,
        .rte .rte-upload-state {
          flex-shrink: 0;
          font-size: 11px;
          color: rgb(var(--text-muted));
        }
        .rte .rte-upload-size {
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          font-variant-numeric: tabular-nums;
        }
        .rte .rte-upload-bar {
          flex: 0 0 6rem;
          height: 1px;
          overflow: hidden;
          border-radius: 9999px;
          background: rgb(var(--border));
        }
        .rte .rte-upload-fill {
          display: block;
          width: var(--p, 0%);
          height: 100%;
          background: rgb(var(--text));
          transition: width 160ms linear;
        }
        .rte .rte-upload[data-state='queued'] .rte-upload-fill {
          opacity: 0.4;
        }
        .rte .rte-upload[data-state='failed'] .rte-upload-bar {
          display: none;
        }
        .rte .rte-upload-cancel,
        .rte .rte-upload-retry {
          display: inline-flex;
          flex-shrink: 0;
          align-items: center;
          justify-content: center;
          height: 1.5rem;
          min-width: 1.5rem;
          padding: 0 0.375rem;
          border-radius: 0.375rem;
          font-size: 11px;
          color: rgb(var(--text-muted));
          transition: background-color 120ms, color 120ms;
        }
        .rte .rte-upload-retry {
          border: 1px solid rgb(var(--border));
          font-weight: 500;
        }
        .rte .rte-upload-retry[hidden] {
          display: none;
        }
        .rte .rte-upload-cancel:hover,
        .rte .rte-upload-retry:hover {
          background: rgb(var(--text) / 0.06);
          color: rgb(var(--text));
        }
      `}</style>
    </div>
  );
}

export default RichTextEditor;
