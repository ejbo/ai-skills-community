'use client';

// The rich-text editor's toolbar, v3 (2026-09-15) — Word / 飞书-like.
//
// FULL (发帖 / Wiki / 活动 / 公告 …), in this group order:
//   撤销 重做 | 格式刷 清除格式 | 字体 字号 | 加粗 倾斜 删除线 行内代码 上标 下标 |
//   文字颜色 背景色 | 标题1 标题2 标题3 行高 | 无序 有序 引用 代码块 表格 分隔线 |
//   插入/编辑链接 图片 附件* @提及 表情 投票 插入引用*        (* when the host enables it)
// COMPACT (comment boxes):
//   加粗 倾斜 删除线 行内代码 | 文字颜色 背景色 | 无序 有序 |
//   插入/编辑链接 图片 附件* @提及 表情 投票 插入引用* | 清除格式 | 撤销 重做
// 撤销 / 重做 are in BOTH variants: on a phone or a tablet there is no Mod-Z,
// so in a comment box these two buttons are the only undo there is.
//
// LAYOUT. Each group is one flex cluster; the row wraps BETWEEN clusters from
// `sm` up (the full set needs ~1100 px, a composer column is ~760 px, so it
// takes a second row there and one row on a wide screen) and never inside one.
// Below `sm` the row does NOT wrap: it scrolls sideways in one line — three
// rows of sticky chrome above a phone keyboard is what v2 fixed. Every direct
// child is shrink-0 or the flex row would squeeze the buttons before it ever
// overflowed.
//
// PHONE ORDER. That one scrolling line shows ~5 controls, so below `sm` the
// full variant REORDERS with CSS `order` (the DOM order is the desktop/Word one
// and stays pinned by tests): 加粗…, 颜色, 标题, 列表 and 插入 come first, and
// 撤销/重做, 格式刷/清除格式 and 字体/字号 move to the end — the phone used to
// open on 撤销 重做 格式刷 清除格式 字体, with 加粗 already cut off. `order` is
// safe here because that row never wraps; the dangling-divider pass below only
// hides dividers on a WRAPPED row, i.e. from `sm` up, where order is untouched.
//
// PERFORMANCE — two gates, and the SECOND one is why the editor host is created
// with `shouldRerenderOnTransaction: false` (RichTextEditor):
//   1. readToolbarState runs at most once per distinct (doc, selection, stored
//      marks, painter state, focus, editable): a focus-only or meta-only
//      transaction reuses the snapshot and runs no `can()` dry runs at all.
//      Active values come from mark lookups (activeRichValue, activeLineHeight,
//      isActive) and availability from cheap schema checks (allowsMarkType,
//      lineHeightTargets, undoDepth); dry runs remain only where the rule is the
//      command's own (bold vs inline code, list / heading placement, tables,
//      sup / sub).
//   2. A snapshot with the same VALUES keeps the previous OBJECT
//      (sameToolbarState), so typing a word — which changes the doc but no
//      button — produces no React render and therefore no commit. That matters
//      far beyond this component: react-dom saves and restores the selection
//      around every commit, and on a focused contenteditable that walks the
//      WHOLE post (~3 ms per keystroke on a 180 KB body).
// Anything else that must follow the caret now subscribes for itself: the
// popover placement (primitives.tsx#useToolbarPanel) and the link bubble, both
// only while they are on screen.

import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import type { MarkType } from '@tiptap/pm/model';
import { redoDepth, undoDepth } from '@tiptap/pm/history';
import {
  AtSign,
  BarChart3,
  Blocks,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Minus,
  PaintbrushVertical,
  Paperclip,
  Quote,
  Redo2,
  RemoveFormatting,
  Smile,
  SquareCode,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table as TableIcon,
  Undo2,
} from 'lucide-react';
import { caretInTableCell } from '@/components/markdown-table';
import { activeRichValue } from '@/components/editor/format-marks';
import { formatPainterState, type FormatPainterState } from '@/components/editor/format-painter';
import { activeLineHeight, lineHeightOf, lineHeightTargets } from '@/components/editor/line-height';
import { StickerPicker } from '@/components/stickers/StickerPicker';
import { RICH_MARK_NAME, type RichMarkKind } from '@/lib/rich-marks';
import { ColorSplitButton } from '@/components/editor/toolbar/ColorPicker';
import { FontFamilySelect, FontSizeSelect, LineHeightSelect } from '@/components/editor/toolbar/FontSelects';
import { LinkControls } from '@/components/editor/toolbar/LinkControls';
import { linkAtSelection, selectionTouchesMention, type LinkRange } from '@/components/editor/toolbar/link-edit';
import { insertMentionTrigger, mentionTriggerBlocked } from '@/components/editor/toolbar/mention-trigger';
import { ToolbarButton, ToolbarDivider, ToolbarGroup, ToolbarToneContext, type ToolbarTone } from '@/components/editor/toolbar/primitives';
import { TableToolbar } from '@/components/editor/toolbar/TableToolbar';

export type ToolbarVariant = 'full' | 'compact';

interface Toggle {
  active: boolean;
  disabled: boolean;
}
interface ValueState {
  value: string | null;
  mixed: boolean;
  disabled: boolean;
}

export interface ToolbarState {
  bold: Toggle;
  italic: Toggle;
  strike: Toggle;
  code: Toggle;
  superscript: Toggle;
  subscript: Toggle;
  color: ValueState;
  bg: ValueState;
  size: ValueState;
  font: ValueState;
  lineHeight: ValueState;
  h1: Toggle;
  h2: Toggle;
  h3: Toggle;
  bulletList: Toggle;
  orderedList: Toggle;
  blockquote: Toggle;
  codeBlock: Toggle;
  table: Toggle;
  divider: { disabled: boolean };
  link: Toggle;
  /** The link the focused caret sits in (the bubble). */
  caretLink: LinkRange | null;
  mention: { disabled: boolean };
  undo: { disabled: boolean };
  redo: { disabled: boolean };
  painter: FormatPainterState;
  inTable: boolean;
  /** Table strip (only meaningful while `inTable`). */
  deleteRow: boolean;
  deleteColumn: boolean;
}

/** Can a mark of `type` land anywhere in the selection (a caret: in its block)? */
function markAllowed(editor: Editor, type: MarkType | undefined): boolean {
  if (!type) return false;
  const { selection, doc } = editor.state;
  if (selection.empty) return selection.$from.parent.type.allowsMarkType(type);
  let allowed = false;
  for (const range of selection.ranges) {
    doc.nodesBetween(range.$from.pos, range.$to.pos, (node, _pos, parent) => {
      if (allowed) return false;
      if (node.isInline && (!parent || parent.type.allowsMarkType(type))) allowed = true;
      return !allowed;
    });
    if (allowed) break;
  }
  return allowed;
}

/** The toolbar's snapshot of the editor — see the header for when it is recomputed. */
export function readToolbarState(editor: Editor, disabled: boolean): ToolbarState {
  const { state } = editor;
  const { selection, doc } = state;
  // A FRESH dry run per check: some commands touch the transaction they are
  // handed even without dispatching (format-marks widens a selection over a
  // mention first), so one shared `can()` would leak state between checks.
  const can = () => editor.can();
  const off = (runnable: boolean) => disabled || !runnable;
  // tiptap's canSetMark answers a CARET from the marks around it and never asks
  // whether the parent block allows marks at all — so a caret inside a code
  // block (marks: '') reported bold as runnable.
  const caretRefuses = (mark: string) => {
    const type = state.schema.marks[mark];
    return Boolean(type && selection.empty && !selection.$from.parent.type.allowsMarkType(type));
  };
  const markOff = (mark: string, runnable: boolean) => off(runnable && !caretRefuses(mark));
  // Heading / list / quote / code block / rule in a table CELL: a GFM cell is
  // one line (components/markdown-table.ts isGfmTable). Disabled there.
  const inCell = caretInTableCell(state);
  const blockOff = (runnable: boolean) => off(runnable && !inCell);
  const toggle = (name: string, runnable: boolean, attrs?: Record<string, unknown>): Toggle => ({
    active: editor.isActive(name, attrs),
    disabled: blockOff(runnable),
  });

  const valueOf = (kind: RichMarkKind): ValueState => {
    const type = state.schema.marks[RICH_MARK_NAME[kind]];
    const value = activeRichValue(editor, kind);
    const mixed = value == null && !selection.empty && Boolean(type && doc.rangeHasMark(selection.from, selection.to, type));
    return { value, mixed, disabled: disabled || !markAllowed(editor, type) };
  };

  const targets = lineHeightTargets(doc, selection);
  const lh = activeLineHeight(editor);
  const inTable = editor.isActive('table');
  const codeActive = editor.isActive('code');
  const linkActive = editor.isActive('link');
  const touchesMention = selectionTouchesMention(state);
  const caretLink = editor.isFocused && selection.empty ? linkAtSelection(state) : null;

  return {
    bold: { active: editor.isActive('bold'), disabled: markOff('bold', can().toggleBold()) },
    italic: { active: editor.isActive('italic'), disabled: markOff('italic', can().toggleItalic()) },
    strike: { active: editor.isActive('strike'), disabled: markOff('strike', can().toggleStrike()) },
    // Inline code can always be turned OFF.
    code: { active: codeActive, disabled: codeActive ? disabled : markOff('code', can().toggleCode()) },
    superscript: { active: editor.isActive('superscript'), disabled: off(can().toggleSuperscript()) },
    subscript: { active: editor.isActive('subscript'), disabled: off(can().toggleSubscript()) },
    color: valueOf('color'),
    bg: valueOf('bg'),
    size: valueOf('size'),
    font: valueOf('font'),
    lineHeight: {
      value: lh,
      mixed: lh == null && targets.some((t) => lineHeightOf(t.node) != null),
      // setLineHeight refuses exactly when there is no eligible top-level block (a table cell, a code block).
      disabled: disabled || targets.length === 0,
    },
    h1: toggle('heading', can().toggleHeading({ level: 1 }), { level: 1 }),
    h2: toggle('heading', can().toggleHeading({ level: 2 }), { level: 2 }),
    h3: toggle('heading', can().toggleHeading({ level: 3 }), { level: 3 }),
    bulletList: toggle('bulletList', can().toggleBulletList()),
    orderedList: toggle('orderedList', can().toggleOrderedList()),
    blockquote: toggle('blockquote', can().toggleBlockquote()),
    codeBlock: toggle('codeBlock', can().toggleCodeBlock()),
    // markdown-table.ts's insertTable refuses a table inside a table (GFM cannot nest one).
    table: { active: inTable, disabled: off(can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })) },
    divider: { disabled: blockOff(can().setHorizontalRule()) },
    // An @mention is never re-pointed through the link dialog; adding a link is not possible inside code.
    link: { active: linkActive, disabled: disabled || touchesMention || (!linkActive && !markAllowed(editor, state.schema.marks.link)) },
    caretLink,
    mention: { disabled: disabled || mentionTriggerBlocked(editor) },
    undo: { disabled: disabled || undoDepth(state) === 0 },
    redo: { disabled: disabled || redoDepth(state) === 0 },
    painter: formatPainterState(state),
    inTable,
    // Only inside a table: two more dry runs on every caret move otherwise.
    deleteRow: inTable && can().deleteRow(),
    deleteColumn: inTable && can().deleteColumn(),
  };
}

/** Same VALUES = the same toolbar, whatever the document did (see PERFORMANCE). */
const TOGGLES = ['bold', 'italic', 'strike', 'code', 'superscript', 'subscript', 'h1', 'h2', 'h3', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'table', 'link'] as const;
const VALUES = ['color', 'bg', 'size', 'font', 'lineHeight'] as const;
const FLAGS = ['inTable', 'deleteRow', 'deleteColumn'] as const;
const DISABLED_ONLY = ['divider', 'mention', 'undo', 'redo'] as const;

export function sameToolbarState(a: ToolbarState, b: ToolbarState): boolean {
  for (const k of TOGGLES) if (a[k].active !== b[k].active || a[k].disabled !== b[k].disabled) return false;
  for (const k of VALUES) if (a[k].value !== b[k].value || a[k].mixed !== b[k].mixed || a[k].disabled !== b[k].disabled) return false;
  for (const k of FLAGS) if (a[k] !== b[k]) return false;
  for (const k of DISABLED_ONLY) if (a[k].disabled !== b[k].disabled) return false;
  if (a.painter.armed !== b.painter.armed || a.painter.sticky !== b.painter.sticky || a.painter.marks !== b.painter.marks) return false;
  const [x, y] = [a.caretLink, b.caretLink];
  if (x === y) return true;
  if (!x || !y) return false;
  return x.from === y.from && x.to === y.to && x.href === y.href && x.mention === y.mention;
}

function useToolbarState(editor: Editor, disabled: boolean): ToolbarState {
  // Cached across transactions, not across editors: the toolbar is remounted
  // with its editor.
  const cache = useRef<{ key: readonly unknown[]; state: ToolbarState } | null>(null);
  return useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const off = disabled || !ed.isEditable;
      const key = [ed.state.doc, ed.state.selection, ed.state.storedMarks, formatPainterState(ed.state), ed.isFocused, off];
      const prev = cache.current;
      if (prev && prev.key.every((v, i) => v === key[i])) return prev.state; // gate 1
      const next = readToolbarState(ed, off);
      const state = prev && sameToolbarState(prev.state, next) ? prev.state : next; // gate 2
      cache.current = { key, state };
      return state;
    },
    equalityFn: Object.is,
  });
}

export interface EditorToolbarProps {
  editor: Editor;
  variant: ToolbarVariant;
  uploading: number;
  uploadingFiles: number;
  disabled: boolean;
  /** 'reader' inside the 知识库 reader — popovers portal into `.reader-root` and wear its theme. */
  tone: ToolbarTone;
  onPickImage: () => void;
  /** 📎 上传文件 — rendered only with `embedPicker.upload`. */
  onPickFile?: () => void;
  onOpenPoll: () => void;
  /** 技术专区 插入引用 — rendered only when provided. */
  onOpenEmbed?: () => void;
}

export function EditorToolbar({
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
}: EditorToolbarProps) {
  const t = useTranslations('ui');
  const icon = 'h-4 w-4';
  const full = variant === 'full';
  const s = useToolbarState(editor, disabled);

  // 表情包 picker (portaled; the editor root is overflow-hidden). The 投票
  // dialog lives in RichTextEditor — the in-editor poll cards need its edit mode too.
  const [stickerOpen, setStickerOpen] = useState(false);
  const stickerAnchorRef = useRef<HTMLSpanElement>(null);

  // A divider whose neighbours ended up on different lines (the row wrapped
  // between them) would dangle at a line end or start: hide it — `visibility`,
  // not `display`, so hiding it can never change the wrap it reacts to. Sizes
  // change on wrap and when a trigger's label changes width; nothing here runs
  // per transaction.
  //
  // The deps are PRESENCE, not identity: a host passing `onOpenEmbed` as a
  // fresh arrow per render (which tiptap makes it do on every transaction)
  // otherwise tore the observer down and re-read every divider's offsetTop —
  // a forced layout in the commit phase — on every keystroke.
  const hasFileButton = Boolean(onPickFile);
  const hasEmbedButton = Boolean(onOpenEmbed);
  const rowRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const mark = () => {
      row.querySelectorAll<HTMLElement>(':scope > .rte-toolbar-divider').forEach((divider) => {
        const prev = divider.previousElementSibling as HTMLElement | null;
        const next = divider.nextElementSibling as HTMLElement | null;
        const dangling = !prev || !next || prev.offsetTop !== next.offsetTop;
        divider.style.visibility = dangling ? 'hidden' : '';
      });
    };
    mark();
    const ro = new ResizeObserver(mark);
    ro.observe(row);
    row.querySelectorAll(':scope > [data-rte-group]').forEach((g) => ro.observe(g));
    return () => ro.disconnect();
  }, [variant, hasFileButton, hasEmbedButton]);

  const run = (fn: (chain: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => () => {
    fn(editor.chain().focus()).run();
  };

  const bold = (
    <ToolbarButton control="bold" title={t('rte_bold')} shortcut="bold" active={s.bold.active} disabled={s.bold.disabled} onClick={run((c) => c.toggleBold())}>
      <Bold className={icon} />
    </ToolbarButton>
  );
  const italic = (
    <ToolbarButton control="italic" title={t('rte_italic')} shortcut="italic" active={s.italic.active} disabled={s.italic.disabled} onClick={run((c) => c.toggleItalic())}>
      <Italic className={icon} />
    </ToolbarButton>
  );
  const strike = (
    <ToolbarButton control="strike" title={t('rte_strike')} shortcut="strike" active={s.strike.active} disabled={s.strike.disabled} onClick={run((c) => c.toggleStrike())}>
      <Strikethrough className={icon} />
    </ToolbarButton>
  );
  // Inline code = `<>` (Code); the code BLOCK is a framed square (SquareCode).
  const inlineCode = (
    <ToolbarButton control="code" title={t('rte_inline_code')} shortcut="code" active={s.code.active} disabled={s.code.disabled} onClick={run((c) => c.toggleCode())}>
      <Code className={icon} />
    </ToolbarButton>
  );
  const colors = (
    <>
      <ColorSplitButton editor={editor} kind="color" value={s.color.value} mixed={s.color.mixed} disabled={s.color.disabled} />
      <ColorSplitButton editor={editor} kind="bg" value={s.bg.value} mixed={s.bg.mixed} disabled={s.bg.disabled} />
    </>
  );
  const lists = (
    <>
      <ToolbarButton control="bullet-list" title={t('rte_bullet_list')} shortcut="bulletList" active={s.bulletList.active} disabled={s.bulletList.disabled} onClick={run((c) => c.toggleBulletList())}>
        <List className={icon} />
      </ToolbarButton>
      <ToolbarButton control="ordered-list" title={t('rte_ordered_list')} shortcut="orderedList" active={s.orderedList.active} disabled={s.orderedList.disabled} onClick={run((c) => c.toggleOrderedList())}>
        <ListOrdered className={icon} />
      </ToolbarButton>
    </>
  );
  const clear = (
    <ToolbarButton control="clear-format" title={t('rte_clear_format')} disabled={disabled} onClick={run((c) => c.clearRichFormatting())}>
      <RemoveFormatting className={icon} />
    </ToolbarButton>
  );
  // Both variants: a comment box on a touch device has no Mod-Z.
  const history = (
    <ToolbarGroup id="history" label={t('rte_group_history')} className={full ? 'max-sm:order-2' : undefined}>
      <ToolbarButton control="undo" title={t('rte_undo')} shortcut="undo" disabled={s.undo.disabled} onClick={run((c) => c.undo())}>
        <Undo2 className={icon} />
      </ToolbarButton>
      <ToolbarButton control="redo" title={t('rte_redo')} shortcut="redo" disabled={s.redo.disabled} onClick={run((c) => c.redo())}>
        <Redo2 className={icon} />
      </ToolbarButton>
    </ToolbarGroup>
  );
  const insert = (
    <ToolbarGroup id="insert" label={t('rte_group_insert')}>
      <LinkControls
        editor={editor}
        active={s.link.active}
        disabled={s.link.disabled}
        editorDisabled={disabled}
        link={s.caretLink}
        suppressBubble={s.painter.armed}
      />
      <ToolbarButton control="image" title={t('rte_insert_image')} disabled={disabled || uploading > 0} onClick={onPickImage}>
        {uploading > 0 ? <Loader2 className={`${icon} animate-spin`} /> : <ImageIcon className={icon} />}
      </ToolbarButton>
      {onPickFile && (
        // Stays enabled while a file uploads — the queue sequences them.
        <ToolbarButton control="file" title={t('rte_upload_file')} disabled={disabled} onClick={onPickFile}>
          {uploadingFiles > 0 ? <Loader2 className={`${icon} animate-spin`} /> : <Paperclip className={icon} />}
        </ToolbarButton>
      )}
      <ToolbarButton control="mention" title={t('rte_mention')} disabled={s.mention.disabled} onClick={() => insertMentionTrigger(editor)}>
        <AtSign className={icon} />
      </ToolbarButton>
      <span ref={stickerAnchorRef} className="inline-flex">
        <ToolbarButton control="sticker" title={t('rte_sticker')} active={stickerOpen} disabled={disabled} onClick={() => setStickerOpen((o) => !o)}>
          <Smile className={icon} />
        </ToolbarButton>
      </span>
      <ToolbarButton control="poll" title={t('rte_poll')} disabled={disabled} onClick={onOpenPoll}>
        <BarChart3 className={icon} />
      </ToolbarButton>
      {onOpenEmbed && (
        <ToolbarButton control="embed" title={t('rte_embed')} disabled={disabled} onClick={onOpenEmbed}>
          <Blocks className={icon} />
        </ToolbarButton>
      )}
    </ToolbarGroup>
  );

  return (
    <ToolbarToneContext.Provider value={tone}>
      {/* `relative`: the table strip below is an OVERLAY anchored to this box. */}
      <div className="rte-toolbar relative border-b border-[rgb(var(--border))]" data-variant={variant}>
        <div ref={rowRef} className="rte-toolbar-row flex items-center gap-x-0.5 gap-y-1 overflow-x-auto px-1.5 py-1 sm:flex-wrap sm:overflow-x-visible [&>*]:shrink-0">
          {full ? (
            <>
              {history}
              <ToolbarDivider className="max-sm:order-2" />
              <ToolbarGroup id="format-tools" label={t('rte_group_format_tools')} className="max-sm:order-2">
                <ToolbarButton
                  control="format-painter"
                  title={t('rte_format_painter')}
                  hint={t('rte_format_painter_hint')}
                  active={s.painter.armed}
                  disabled={disabled}
                  onClick={(e) => {
                    // Double-click = sticky: its second click (detail 2) re-arms in sticky mode.
                    if (e.detail >= 2) {
                      editor.chain().focus().armFormatPainter({ sticky: true }).run();
                      return;
                    }
                    if (formatPainterState(editor.state).armed) editor.chain().focus().disarmFormatPainter().run();
                    else editor.chain().focus().armFormatPainter().run();
                  }}
                >
                  <PaintbrushVertical className={icon} />
                </ToolbarButton>
                {clear}
              </ToolbarGroup>
              <ToolbarDivider className="max-sm:order-2" />
              <ToolbarGroup id="font" label={t('rte_group_font')} className="max-sm:order-2">
                <FontFamilySelect editor={editor} value={s.font.value} mixed={s.font.mixed} disabled={s.font.disabled} />
                <FontSizeSelect editor={editor} value={s.size.value} mixed={s.size.mixed} disabled={s.size.disabled} />
              </ToolbarGroup>
              {/* On a phone this divider lands between 插入 and the three groups pushed to the end. */}
              <ToolbarDivider className="max-sm:order-1" />
              <ToolbarGroup id="marks" label={t('rte_group_marks')}>
                {bold}
                {italic}
                {strike}
                {inlineCode}
                <ToolbarButton control="superscript" title={t('rte_superscript')} shortcut="superscript" active={s.superscript.active} disabled={s.superscript.disabled} onClick={run((c) => c.toggleSuperscript())}>
                  <SuperscriptIcon className={icon} />
                </ToolbarButton>
                <ToolbarButton control="subscript" title={t('rte_subscript')} shortcut="subscript" active={s.subscript.active} disabled={s.subscript.disabled} onClick={run((c) => c.toggleSubscript())}>
                  <SubscriptIcon className={icon} />
                </ToolbarButton>
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup id="color" label={t('rte_group_color')}>{colors}</ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup id="paragraph" label={t('rte_group_paragraph')}>
                <ToolbarButton control="h1" title={t('rte_h1')} shortcut="h1" active={s.h1.active} disabled={s.h1.disabled} onClick={run((c) => c.toggleHeading({ level: 1 }))}>
                  <Heading1 className={icon} />
                </ToolbarButton>
                <ToolbarButton control="h2" title={t('rte_h2')} shortcut="h2" active={s.h2.active} disabled={s.h2.disabled} onClick={run((c) => c.toggleHeading({ level: 2 }))}>
                  <Heading2 className={icon} />
                </ToolbarButton>
                <ToolbarButton control="h3" title={t('rte_h3')} shortcut="h3" active={s.h3.active} disabled={s.h3.disabled} onClick={run((c) => c.toggleHeading({ level: 3 }))}>
                  <Heading3 className={icon} />
                </ToolbarButton>
                <LineHeightSelect editor={editor} value={s.lineHeight.value} mixed={s.lineHeight.mixed} disabled={s.lineHeight.disabled} />
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup id="blocks" label={t('rte_group_blocks')}>
                {lists}
                <ToolbarButton control="blockquote" title={t('rte_quote')} shortcut="blockquote" active={s.blockquote.active} disabled={s.blockquote.disabled} onClick={run((c) => c.toggleBlockquote())}>
                  <Quote className={icon} />
                </ToolbarButton>
                <ToolbarButton control="code-block" title={t('rte_code_block')} shortcut="codeBlock" active={s.codeBlock.active} disabled={s.codeBlock.disabled} onClick={run((c) => c.toggleCodeBlock())}>
                  <SquareCode className={icon} />
                </ToolbarButton>
                <ToolbarButton
                  control="table"
                  title={t('rte_table_insert')}
                  active={s.table.active}
                  disabled={s.table.disabled}
                  onClick={run((c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }))}
                >
                  <TableIcon className={icon} />
                </ToolbarButton>
                <ToolbarButton control="divider" title={t('rte_divider')} disabled={s.divider.disabled} onClick={run((c) => c.setHorizontalRule())}>
                  <Minus className={icon} />
                </ToolbarButton>
              </ToolbarGroup>
              <ToolbarDivider />
              {insert}
            </>
          ) : (
            <>
              <ToolbarGroup id="marks" label={t('rte_group_marks')}>
                {bold}
                {italic}
                {strike}
                {inlineCode}
              </ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup id="color" label={t('rte_group_color')}>{colors}</ToolbarGroup>
              <ToolbarDivider />
              <ToolbarGroup id="blocks" label={t('rte_group_blocks')}>{lists}</ToolbarGroup>
              <ToolbarDivider />
              {insert}
              <ToolbarDivider />
              <ToolbarGroup id="format-tools" label={t('rte_group_format_tools')}>{clear}</ToolbarGroup>
              <ToolbarDivider />
              {history}
            </>
          )}

          <StickerPicker
            open={stickerOpen}
            anchor={stickerAnchorRef.current}
            onClose={() => setStickerOpen(false)}
            onSelect={(sticker) => {
              // Inline node: the sticker lands in the text flow at the cursor.
              editor.chain().focus().insertContent({ type: 'stickerImage', attrs: { src: sticker.url, alt: 'sticker' } }).run();
            }}
          />
        </div>
        {s.inTable && <TableToolbar editor={editor} canDeleteRow={s.deleteRow} canDeleteColumn={s.deleteColumn} />}
      </div>
    </ToolbarToneContext.Provider>
  );
}
