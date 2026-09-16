'use client';

// Reusable WYSIWYG rich-text editor. Markdown in / Markdown out, so it is a
// drop-in for the app's existing `value`/`onChange` markdown textareas — the DB,
// API validation, the MarkdownRenderer pipeline and AI-assist are all unchanged.
//
// Built on Tiptap v2 + tiptap-markdown. Supports bold/italic/strike, inline
// code, 上标/下标, text colour / background (any hex) / 字号 / 字体 / 行高, 格式刷,
// headings, lists, quote, code blocks with language + filename
// (components/editor/CodeBlockView.tsx), links (插入/编辑链接 dialog + caret bubble),
// horizontal rule, GFM tables, undo/redo, and inline IMAGE upload (toolbar pick
// / drag-drop / paste) to /api/uploads/image. The toolbar itself is
// components/editor/toolbar/EditorToolbar.tsx (full / compact variants).
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
import { isInsideTable, pasteEscapePos, sliceHasBlockAtom } from '@/components/markdown-table';
import { beginInsertBatch, endInsertBatch, insertIntoBatch } from '@/components/editor/flow-extension';
import { ensureParagraphAt, setCaret } from '@/components/editor/flow-insert';
import { buildRichTextExtensions } from '@/components/editor/rich-text-extensions';
import { unsupportedMarkdownConstructs, type MarkdownParserLike, type UnsupportedConstruct } from '@/components/editor/unsupported-markdown';
import { CodeBlockWithView } from '@/components/editor/CodeBlockView';
import { EditorToolbar } from '@/components/editor/toolbar/EditorToolbar';
import { AlertTriangle, FileUp } from 'lucide-react';
import { withBasePath } from '@/lib/base-path';
import { RASTER_IMAGE_EXTS, RASTER_IMAGE_MIMES, isRasterImage, uploadContentTypeFor } from '@/lib/files/file-types';
import { RICH_TEXT_RAW_CEILING_FACTOR, richTextLength } from '@/lib/markdown-text';
import { TWEEN_FAST } from '@/lib/motion';
import { ARTICLE_PROSE_CLASS } from '@/lib/zones/prose';
import { MAX_EMBEDS_PER_CONTENT, formatBytes, type EmbedKind } from '@/lib/zones/shared';
import type { ZoneAttachmentView } from '@/lib/zones/types';
import { pushToast } from '@/components/Toaster';
import { MentionPicker } from '@/components/mention/MentionPicker';
import { type MentionSession } from '@/components/mention/mention-suggestion';
import dynamic from 'next/dynamic';
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

// The two MODAL dialogs are code-split. RichTextEditor is a static import of
// two dozen client components (every comment box on 讨论区 / 视频 / 知识库 /
// 意见反馈), and neither dialog can appear before someone clicks its toolbar
// button — together they were ~20 KB of every one of those first-load chunks.
// They stay mounted once opened (the latches below), so nothing else about
// their lifecycle changes. The toolbar's own popovers are deliberately NOT
// split: a menu or palette must open in the same frame as the click.
const PollComposerDialog = dynamic(() => import('@/components/polls/PollComposerDialog').then((m) => m.PollComposerDialog), { ssr: false });
const EmbedPickerDialog = dynamic(() => import('@/components/zones/embeds/EmbedPickerDialog').then((m) => m.EmbedPickerDialog), { ssr: false });

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
  // and an editor sitting directly on that ground must portal its toolbar
  // panels (字体 / 字号 / 行高 / 颜色 / 链接) into `.reader-root` and wear its
  // variables. An editor on a site
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
  // Latches: once a code-split dialog has been opened it stays mounted, exactly
  // as it was before the split.
  const [pollMounted, setPollMounted] = useState(false);
  const [embedMounted, setEmbedMounted] = useState(false);
  const openPollEditRef = useRef<(pollId: string) => void>(() => {});
  useEffect(() => {
    openPollEditRef.current = (pollId) => setPollDialog({ open: true, pollId });
  }, []);
  useEffect(() => {
    if (pollDialog.open) setPollMounted(true);
  }, [pollDialog.open]);
  useEffect(() => {
    if (embedDialog) setEmbedMounted(true);
  }, [embedDialog]);

  // Stable handlers: an inline arrow here is a NEW prop on the toolbar for every
  // render of this host, which tore down and rebuilt the toolbar's divider
  // ResizeObserver — a forced layout in the commit phase — each time.
  const openPoll = useCallback(() => setPollDialog({ open: true, pollId: null }), []);
  const openEmbed = useCallback(() => setEmbedDialog(true), []);
  const closePoll = useCallback(() => setPollDialog({ open: false, pollId: null }), []);
  const closeEmbed = useCallback(() => setEmbedDialog(false), []);

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
    // tiptap's legacy default re-renders this host on EVERY transaction, and
    // react-dom then walks the whole focused contenteditable to save and restore
    // the selection around the commit (~3 ms per keystroke on a long post).
    // Everything that needs the caret subscribes for itself now — the toolbar
    // (EditorToolbar#useToolbarState, which re-renders only when a control
    // actually changes), its open popovers, and the link bubble.
    shouldRerenderOnTransaction: false,
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
  // ONE scan per distinct `value`, never per render: this host still re-renders
  // for reasons of its own (an upload counter, a host feeding `value` back per
  // keystroke), and the old inline pair scanned a long article twice each time. Same gate as isRichTextTooLong (lib/markdown-text.ts): visible
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
      <EditorToolbar
        editor={editor}
        variant={variant}
        uploading={uploading}
        uploadingFiles={uploadingFiles}
        disabled={disabled}
        tone={tone}
        onPickImage={onPickImage}
        onPickFile={uploadOn ? onPickFile : undefined}
        onOpenPoll={openPoll}
        onOpenEmbed={embedPicker && embedEnabledRef.current ? openEmbed : undefined}
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
      {(pollDialog.open || pollMounted) && (
      <PollComposerDialog
        open={pollDialog.open}
        pollId={pollDialog.pollId}
        onClose={closePoll}
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
      )}
      {embedPicker && embedEnabledRef.current && (embedDialog || embedMounted) && (
        <EmbedPickerDialog
          open={embedDialog}
          onClose={closeEmbed}
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
        /* 格式刷 armed (components/editor/format-painter.ts): a brush cursor over
           the text, black with a white halo so it reads on light and dark
           grounds. Hotspot = the bristle tip. The slashes of the SVG namespace
           are percent-encoded: styled-jsx's CSS parser reads a literal double
           slash as a line comment and silently dropped the whole declaration. */
        .rte .ProseMirror.rte-painter-armed,
        .rte .ProseMirror.rte-painter-armed * {
          cursor: url("data:image/svg+xml,%3Csvg xmlns='http:%2F%2Fwww.w3.org%2F2000%2Fsvg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M10 2v2M14 2v4M17 2a1 1 0 0 1 1 1v9H6V3a1 1 0 0 1 1-1zM6 12a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v2.9a2 2 0 1 0 4 0V17a1 1 0 0 1 1-1h2a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1' stroke='white' stroke-width='4'/%3E%3Cpath d='M10 2v2M14 2v4M17 2a1 1 0 0 1 1 1v9H6V3a1 1 0 0 1 1-1zM6 12a1 1 0 0 0-1 1v1a2 2 0 0 0 2 2h2a1 1 0 0 1 1 1v2.9a2 2 0 1 0 4 0V17a1 1 0 0 1 1-1h2a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1' stroke='black' stroke-width='2'/%3E%3C/svg%3E") 12 22, copy;
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
