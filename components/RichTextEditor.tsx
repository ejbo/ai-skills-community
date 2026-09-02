'use client';

// Reusable WYSIWYG rich-text editor. Markdown in / Markdown out, so it is a
// drop-in for the app's existing `value`/`onChange` markdown textareas — the DB,
// API validation, the MarkdownRenderer pipeline and AI-assist are all unchanged.
//
// Built on Tiptap v2 + tiptap-markdown. Supports bold/italic/strike/code,
// headings, lists, quote, code block, links, horizontal rule, GFM tables,
// undo/redo, and inline IMAGE upload (toolbar pick / drag-drop / paste) to
// /api/uploads/image.
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
// Usage:
//   <RichTextEditor value={md} onChange={setMd} placeholder="…" variant="full" />

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { TABLE_EXTENSIONS, isInsideTable, pasteEscapePos, sliceHasBlockAtom, tableEscapePos } from '@/components/markdown-table';
import { Markdown } from 'tiptap-markdown';
import {
  BarChart3,
  Blocks,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Code2,
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
import { TWEEN_FAST } from '@/lib/motion';
import { STICKER_URL_PREFIX } from '@/lib/stickers';
import { ARTICLE_PROSE_CLASS } from '@/lib/zones/prose';
import { MAX_EMBEDS_PER_CONTENT, ZONE_FILE_ACCEPT, ZONE_VIDEO_TYPES, formatBytes, type EmbedKind } from '@/lib/zones/shared';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { pushToast } from '@/components/Toaster';
import { StickerPicker } from '@/components/stickers/StickerPicker';
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
import { FileUploadPlaceholder, blockPosFor, startFileUpload } from '@/components/zones/embeds/file-upload-plugin';
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

// Image node with: (1) basePath applied to the DISPLAYED src only (stored attrs
// stay root-relative + portable), (2) a `width` attribute, (3) drag-to-resize via
// a corner handle when selected, (4) markdown that persists width as an HTML
// <img> — plain `![](…)` can't carry a size, and MarkdownRenderer already renders
// <img width> (sanitizeSchema allows it). Without a width it stays normal markdown.
const escAttr = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const BasePathImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const raw = el.getAttribute('width') || el.style.width || '';
          const n = parseInt(String(raw), 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs: { width?: number | null }) => (attrs.width ? { width: attrs.width } : {}),
      },
    };
  },
  renderHTML({ HTMLAttributes }) {
    const attrs: Record<string, unknown> = { ...HTMLAttributes };
    if (typeof attrs.src === 'string') attrs.src = withBasePath(attrs.src);
    return ['img', mergeAttributes(this.options.HTMLAttributes, attrs)];
  },
  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const { src, alt, title, width } = node.attrs;
          if (width) {
            state.write(
              `<img src="${escAttr(src)}" alt="${escAttr(alt)}"${
                title ? ` title="${escAttr(title)}"` : ''
              } width="${width}">`,
            );
          } else {
            state.write(
              '![' +
                state.esc(alt || '') +
                '](' +
                String(src ?? '').replace(/[()]/g, '\\$&') +
                (title ? ' "' + String(title).replace(/"/g, '\\"') + '"' : '') +
                ')',
            );
          }
        },
      },
    };
  },
  addNodeView() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((props: any) => {
      const { editor, getPos } = props;
      let node = props.node;

      // 表情包 render small + fixed in the editor too, and skip the drag-resize
      // handle — a resized sticker would serialize as HTML <img width> and
      // escape the constrained size the renderer gives stickers.
      const isSticker =
        typeof node.attrs.src === 'string' && node.attrs.src.startsWith(STICKER_URL_PREFIX);

      const wrap = document.createElement('span');
      wrap.className = isSticker ? 'rte-img rte-sticker' : 'rte-img';

      const img = document.createElement('img');
      img.draggable = false;
      const sync = (n: { attrs: Record<string, unknown> }) => {
        img.src = withBasePath(typeof n.attrs.src === 'string' ? n.attrs.src : '');
        img.alt = typeof n.attrs.alt === 'string' ? n.attrs.alt : '';
        if (typeof n.attrs.title === 'string') img.title = n.attrs.title;
        else img.removeAttribute('title');
        img.style.width = n.attrs.width ? `${n.attrs.width}px` : '';
      };
      sync(node);

      const handle = document.createElement('span');
      handle.className = 'rte-img-handle';
      handle.contentEditable = 'false';

      let startX = 0;
      let startW = 0;
      let dragging = false;
      const onMove = (e: MouseEvent) => {
        if (!dragging) return;
        img.style.width = `${Math.max(40, Math.round(startW + (e.clientX - startX)))}px`;
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        const width = Math.round(img.getBoundingClientRect().width);
        const attrs = { ...(editor.view.state.doc.nodeAt(pos)?.attrs ?? {}), width };
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(pos, undefined, attrs));
      };
      const onDown = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startW = img.getBoundingClientRect().width;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      };
      if (!isSticker) handle.addEventListener('mousedown', onDown);

      wrap.appendChild(img);
      if (!isSticker) wrap.appendChild(handle);

      return {
        dom: wrap,
        update: (updated: { type: unknown; attrs: Record<string, unknown> }) => {
          if (updated.type !== node.type) return false;
          // The sticker branch (class + no resize handle) is decided at
          // construction — force a rebuild if the src flips across the line.
          const nowSticker =
            typeof updated.attrs.src === 'string' &&
            (updated.attrs.src as string).startsWith(STICKER_URL_PREFIX);
          if (nowSticker !== isSticker) return false;
          node = updated;
          sync(updated);
          return true;
        },
        selectNode: () => wrap.classList.add('is-selected'),
        deselectNode: () => wrap.classList.remove('is-selected'),
        ignoreMutation: () => true,
        destroy: () => {
          handle.removeEventListener('mousedown', onDown);
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;
  },
});

// 表情包 as an INLINE node (WeChat-style: stickers sit in the text flow, several
// per line) — a separate node type so regular uploaded images keep their block
// content model. Inherits BasePathImage's nodeview (isSticker branch), markdown
// serializer (stickers never carry width ⇒ plain `![alt](src)`), and attrs.
// parseHTML priority 100 beats the block image's generic img[src] rule, so
// stored `![sticker](/api/uploads/stickers/…)` markdown re-opens as this node.
const StickerImageNode = BasePathImage.extend({
  name: 'stickerImage',
  draggable: false,
  inline() {
    return true;
  },
  group() {
    return 'inline';
  },
  addCommands() {
    // Keep BasePathImage's setImage the only `setImage` — a second registration
    // (inherited addCommands references this.name) would hijack normal image
    // inserts into the sticker node.
    return {};
  },
  parseHTML() {
    return [{ tag: `img[src^="${STICKER_URL_PREFIX}"]`, priority: 100 }];
  },
});

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


async function uploadImage(file: File): Promise<string | null> {
  try {
    const res = await fetch(withBasePath('/api/uploads/image'), {
      method: 'POST',
      headers: {
        'content-type': file.type,
        'x-filename': encodeURIComponent(file.name),
      },
      body: file,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return typeof data.url === 'string' ? data.url : null;
  } catch {
    return null;
  }
}

const isImageFile = (f: File) => f.type.startsWith('image/');
const hasFiles = (dt: DataTransfer | null) => Boolean(dt && Array.from(dt.types).includes('Files'));

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
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

/** Compact strip shown only while the caret sits inside a table. */
function TableToolbar({ editor }: { editor: Editor }) {
  const t = useTranslations('ui');
  const icon = 'h-3.5 w-3.5';
  const btn =
    'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-50';
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-t border-[rgb(var(--border))] px-1.5 py-1" role="toolbar" aria-label={t('rte_table_toolbar')}>
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
  onPickImage: () => void;
  /** 📎 上传文件 — rendered only with `embedPicker.upload`. */
  onPickFile?: () => void;
  onOpenPoll: () => void;
  /** 技术专区 插入引用 — rendered only when provided. */
  onOpenEmbed?: () => void;
}) {
  const t = useTranslations('ui');
  const icon = 'h-4 w-4';

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

  return (
    <div className="rte-toolbar border-b border-[rgb(var(--border))]">
      <div className="flex flex-wrap items-center gap-0.5 px-1.5 py-1">
        <ToolbarButton title={t('rte_bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className={icon} />
        </ToolbarButton>
        <ToolbarButton title={t('rte_italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className={icon} />
        </ToolbarButton>
        <ToolbarButton title={t('rte_strike')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className={icon} />
        </ToolbarButton>
        <ToolbarButton title={t('rte_inline_code')} active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code className={icon} />
        </ToolbarButton>

        {variant === 'full' && (
          <>
            <Divider />
            <ToolbarButton title={t('rte_h1')} active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
              <Heading1 className={icon} />
            </ToolbarButton>
            <ToolbarButton title={t('rte_h2')} active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
              <Heading2 className={icon} />
            </ToolbarButton>
            <ToolbarButton title={t('rte_h3')} active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
              <Heading3 className={icon} />
            </ToolbarButton>
          </>
        )}

        <Divider />
        <ToolbarButton title={t('rte_bullet_list')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className={icon} />
        </ToolbarButton>
        <ToolbarButton title={t('rte_ordered_list')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className={icon} />
        </ToolbarButton>

        {variant === 'full' && (
          <>
            <ToolbarButton title={t('rte_quote')} active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
              <Quote className={icon} />
            </ToolbarButton>
            <ToolbarButton title={t('rte_code_block')} active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
              <Code2 className={icon} />
            </ToolbarButton>
            <ToolbarButton
              title={t('rte_table_insert')}
              active={editor.isActive('table')}
              disabled={disabled}
              onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
            >
              <TableIcon className={icon} />
            </ToolbarButton>
          </>
        )}

        <Divider />
        <ToolbarButton title={t('rte_link')} active={editor.isActive('link')} onClick={setLink}>
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
          <ToolbarButton title={t('rte_divider')} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
            <Minus className={icon} />
          </ToolbarButton>
        )}

        <Divider />
        <ToolbarButton title={t('rte_undo')} disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className={icon} />
        </ToolbarButton>
        <ToolbarButton title={t('rte_redo')} disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
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
      {editor.isActive('table') && <TableToolbar editor={editor} />}
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

  // Keep the latest onChange without re-creating the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Insert closures, ref-backed so the (once-created) editorProps paste/drop
  // handlers always call the live version (set in an effect once the editor
  // exists). Declared before useEditor so the handlers can reference them.
  const insertImageRef = useRef<(file: File) => void>(() => {});
  const insertFilesRef = useRef<(files: File[], pos?: number) => void>(() => {});

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
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      }),
      ...TABLE_EXTENSIONS,
      BasePathImage,
      StickerImageNode,
      PollEmbedWithView.configure({ onEdit: (id: string) => openPollEditRef.current(id) }),
      ...(embedEnabledRef.current
        ? [
            ContentEmbedWithView.configure({
              getLocal: () => localRef.current,
              onPreview: (target: ContentEmbedPreviewTarget) =>
                previewRef.current.open({ kind: target.kind, ref: target.ref, title: target.title, data: target.data, via: target.via }),
            }),
          ]
        : []),
      ...(uploadEnabledRef.current ? [FileUploadPlaceholder.configure({ labels: uploadLabelsRef.current })] : []),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
    ],
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
              view.dispatch(view.state.tr.insert(escape, slice.content));
              return true;
            } catch {
              return false; // an open slice that will not fit at depth 0 — let ProseMirror paste it
            }
          }
          return false; // let tiptap-markdown handle pasted text
        }
        const images = files.filter(isImageFile);
        const others = uploadEnabledRef.current ? files.filter((f) => !isImageFile(f)) : [];
        if (images.length === 0 && others.length === 0) return false;
        event.preventDefault();
        images.forEach((f) => insertImageRef.current(f));
        if (others.length > 0) insertFilesRef.current(others, view.state.selection.to);
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
        const images = files.filter(isImageFile);
        const others = uploadEnabledRef.current ? files.filter((f) => !isImageFile(f)) : [];
        if (images.length === 0 && others.length === 0) return false; // 讨论区 / 意见反馈: non-image drops stay inert
        event.preventDefault();
        images.forEach((f) => insertImageRef.current(f));
        if (others.length > 0) {
          const hit = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
          insertFilesRef.current(others, hit?.pos ?? view.state.selection.to);
        }
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.storage.markdown.getMarkdown());
      if (embedEnabledRef.current) {
        const n = countEmbeds(editor);
        if (n !== embedCountRef.current) {
          embedCountRef.current = n;
          setEmbedCount(n);
        }
      }
    },
  });

  // Hand the live editor to the host (在正文插入 from the ledger).
  useEffect(() => {
    if (editorRef) editorRef.current = editor ?? null;
  }, [editor, editorRef]);

  // Wire the live insert-image implementation (needs the created editor).
  useEffect(() => {
    insertImageRef.current = async (file: File) => {
      if (!editor || !file.type.startsWith('image/')) return;
      setUploading((n) => n + 1);
      try {
        const url = await uploadImage(file);
        if (url) {
          const attrs = { src: url, alt: file.name.replace(/\.[^.]+$/, '') };
          // A GFM cell is inline-only: an image dropped at a caret inside a table
          // degraded the whole table to raw HTML (components/markdown-table.ts).
          // Land it right after the table instead — the same lift the embed and
          // poll inserts already do for a nested caret.
          const escape = tableEscapePos(editor.state);
          if (escape == null) editor.chain().focus().setImage(attrs).run();
          else editor.chain().focus().insertContentAt(escape, { type: 'image', attrs }).run();
        }
      } finally {
        setUploading((n) => n - 1);
      }
    };
  }, [editor]);

  // Non-image files → placeholder at the caret block, sequential upload queue
  // (file-upload-plugin.ts). Byte caps are checked here first (the server
  // checks again); unsupported types toast and skip. Images that arrive via
  // 📎 still take the inline-image path.
  useEffect(() => {
    insertFilesRef.current = (files, pos) => {
      if (!editor || !uploadEnabledRef.current) return;
      const view = editor.view;
      const at = pos ?? view.state.selection.to;
      for (const file of files) {
        if (isImageFile(file)) {
          insertImageRef.current(file);
          continue;
        }
        const kind = classify(file);
        const name = clampAttachmentName(file.name);
        if (!kind) {
          pushToast('error', tz('attach_upload_error', { name, error: tz('attach_err_unsupported_type') }));
          continue;
        }
        if (file.size > MAX_BYTES[kind]) {
          pushToast('error', tz('attach_too_large', { name, max: formatBytes(MAX_BYTES[kind]) }));
          continue;
        }
        startFileUpload(view, file, at, {
          upload: (f, onProgress, signal) =>
            uploadRaw(f, uploadEndpoint(uploadRef.current?.zoneSlug ?? ''), { 'x-upload-kind': kind }, onProgress, signal).then((r) => ({
              key: r.key,
              draft: draftFromUpload(f, kind, r, name),
            })),
          onDone: (draft) => uploadRef.current?.onUploaded(draft),
          onError: (_f, e) => pushToast('error', tz('attach_upload_error', { name, error: tz(uploadErrorKey(e)) })),
          onBusy: (busy) => setUploadingFiles((n) => Math.max(0, n + (busy ? 1 : -1))),
        });
      }
    };
  }, [editor, tz]);

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
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value || '', false);
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
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => insertImageRef.current(f));
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

  const over = maxLength != null && value.length > maxLength;
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
        onPickImage={onPickImage}
        onPickFile={uploadOn ? onPickFile : undefined}
        onOpenPoll={() => setPollDialog({ open: true, pollId: null })}
        onOpenEmbed={embedPicker && embedEnabledRef.current ? () => setEmbedDialog(true) : undefined}
      />
      <EditorContent editor={editor} style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined} />
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onFileChange} />
      {uploadOn && (
        <input
          ref={uploadInputRef}
          type="file"
          accept={`${ZONE_FILE_ACCEPT},${Array.from(ZONE_VIDEO_TYPES).join(',')}`}
          multiple
          hidden
          onChange={onUploadChange}
        />
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
              {value.length} / {maxLength}
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
