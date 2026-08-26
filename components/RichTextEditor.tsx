'use client';

// Reusable WYSIWYG rich-text editor. Markdown in / Markdown out, so it is a
// drop-in for the app's existing `value`/`onChange` markdown textareas — the DB,
// API validation, the MarkdownRenderer pipeline and AI-assist are all unchanged.
//
// Built on Tiptap v2 + tiptap-markdown. Supports bold/italic/strike/code,
// headings, lists, quote, code block, links, horizontal rule, undo/redo, and
// inline IMAGE upload (toolbar pick / drag-drop / paste) to /api/uploads/image.
//
// Usage:
//   <RichTextEditor value={md} onChange={setMd} placeholder="…" variant="full" />

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useEditor, EditorContent, ReactNodeViewRenderer, type Editor } from '@tiptap/react';
import { mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import {
  BarChart3,
  Blocks,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Image as ImageIcon,
  Minus,
  Smile,
  Undo2,
  Redo2,
  Loader2,
} from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { STICKER_URL_PREFIX } from '@/lib/stickers';
import { StickerPicker } from '@/components/stickers/StickerPicker';
import { PollComposerDialog } from '@/components/polls/PollComposerDialog';
import { PollEmbedBase } from '@/components/polls/poll-embed-extension';
import { PollEmbedView } from '@/components/polls/PollEmbedView';
import { ContentEmbedBase, insertContentEmbed } from '@/components/zones/embeds/embed-node-extension';
import { EmbedNodeView } from '@/components/zones/embeds/EmbedNodeView';
import { EmbedPickerDialog } from '@/components/zones/embeds/EmbedPickerDialog';
import type { ZoneAttachmentView } from '@/lib/zones/types';

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
  /**
   * 技术专区 only: registers the `[embed:<kind>:<ref>]` node + a toolbar
   * 插入引用 button opening EmbedPickerDialog. Decided at editor creation —
   * extensions are wired once. Absent ⇒ every other editor is untouched.
   */
  embedPicker?: { zoneSlug: string; attachments?: ZoneAttachmentView[] };
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
          ? 'bg-accent-500/15 text-accent-600 dark:text-accent-300'
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

function Toolbar({
  editor,
  variant,
  uploading,
  disabled,
  onPickImage,
  onOpenPoll,
  onOpenEmbed,
}: {
  editor: Editor;
  variant: RichTextVariant;
  uploading: number;
  disabled: boolean;
  onPickImage: () => void;
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
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[rgb(var(--border))] px-1.5 py-1">
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
        </>
      )}

      <Divider />
      <ToolbarButton title={t('rte_link')} active={editor.isActive('link')} onClick={setLink}>
        <LinkIcon className={icon} />
      </ToolbarButton>
      <ToolbarButton title={t('rte_insert_image')} disabled={disabled || uploading > 0} onClick={onPickImage}>
        {uploading > 0 ? <Loader2 className={`${icon} animate-spin`} /> : <ImageIcon className={icon} />}
      </ToolbarButton>
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
  );
}

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
  embedPicker,
}: RichTextEditorProps) {
  const [uploading, setUploading] = useState(0);
  // 技术专区 插入引用 dialog. Whether the node is registered is fixed at
  // creation (extensions are wired once), so latch the prop's presence.
  const [embedDialog, setEmbedDialog] = useState(false);
  const embedEnabledRef = useRef(Boolean(embedPicker));
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Insert-an-image closure, ref-backed so the (once-created) editorProps paste/
  // drop handlers always call the live version (set in an effect once the editor
  // exists). Declared before useEditor so the handlers can reference it.
  const insertImageRef = useRef<(file: File) => void>(() => {});

  const proseClass =
    variant === 'compact'
      ? 'prose prose-sm prose-zinc max-w-none dark:prose-invert'
      : 'prose prose-zinc max-w-none dark:prose-invert';

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
      BasePathImage,
      StickerImageNode,
      PollEmbedWithView.configure({ onEdit: (id: string) => openPollEditRef.current(id) }),
      ...(embedEnabledRef.current ? [ContentEmbedWithView] : []),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      Markdown.configure({ html: true, transformPastedText: true, breaks: false }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: `rte-content ${proseClass} ${variant === 'compact' ? 'min-h-[4.5rem]' : 'min-h-[9rem]'} px-3 py-2 focus:outline-none`,
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return false; // let tiptap-markdown handle pasted text
        event.preventDefault();
        files.forEach((f) => insertImageRef.current(f));
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach((f) => insertImageRef.current(f));
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChangeRef.current(editor.storage.markdown.getMarkdown());
    },
  });

  // Wire the live insert-image implementation (needs the created editor).
  useEffect(() => {
    insertImageRef.current = async (file: File) => {
      if (!editor || !file.type.startsWith('image/')) return;
      setUploading((n) => n + 1);
      try {
        const url = await uploadImage(file);
        if (url) {
          editor.chain().focus().setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, '') }).run();
        }
      } finally {
        setUploading((n) => n - 1);
      }
    };
  }, [editor]);

  // Controlled sync: when `value` changes externally (AI-assist fill, form reset)
  // and differs from the editor's current markdown, replace the content without
  // emitting an update (so we don't fight the user's keystrokes / move the cursor).
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if (value !== current) {
      editor.commands.setContent(value || '', false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const onPickImage = useCallback(() => fileInputRef.current?.click(), []);
  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((f) => insertImageRef.current(f));
    e.target.value = ''; // allow re-selecting the same file
  }, []);

  const over = maxLength != null && value.length > maxLength;

  if (!editor) {
    // First server render / pre-hydration placeholder (keeps layout stable).
    return (
      <div
        className={`surface rounded-lg ${variant === 'compact' ? 'min-h-[6.5rem]' : 'min-h-[11rem]'} ${className ?? ''}`}
        aria-busy
      />
    );
  }

  return (
    <div className={`rte surface overflow-hidden rounded-lg ${disabled ? 'opacity-60' : ''} ${className ?? ''}`}>
      <Toolbar
        editor={editor}
        variant={variant}
        uploading={uploading}
        disabled={disabled}
        onPickImage={onPickImage}
        onOpenPoll={() => setPollDialog({ open: true, pollId: null })}
        onOpenEmbed={embedPicker && embedEnabledRef.current ? () => setEmbedDialog(true) : undefined}
      />
      <EditorContent editor={editor} style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined} />
      <input ref={fileInputRef} type="file" accept="image/*" multiple hidden onChange={onFileChange} />
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
          zoneSlug={embedPicker.zoneSlug}
          postAttachments={embedPicker.attachments}
          // Same top-level insertion rule as the poll node (see insertContentEmbed).
          onPick={(kind, ref) => insertContentEmbed(editor, kind, ref)}
        />
      )}
      {maxLength != null && (
        <div className={`px-3 pb-1.5 text-right text-[11px] ${over ? 'text-danger' : 'text-muted'}`}>
          {value.length} / {maxLength}
        </div>
      )}

      <style jsx global>{`
        .rte:focus-within {
          border-color: rgb(var(--accent));
          box-shadow: 0 0 0 3px rgb(var(--accent) / 0.15);
        }
        .rte .rte-content {
          font-size: ${variant === 'compact' ? '0.8125rem' : '0.9375rem'};
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
      `}</style>
    </div>
  );
}

export default RichTextEditor;
