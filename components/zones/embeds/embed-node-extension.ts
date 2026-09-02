// In-editor 技术专区 embed node — the editor-side half of the
// `[embed:<kind>:<ref>]` token contract (lib/zones/shared.ts; a `file` ref is a
// row id OR a storage key — the upload plugin inserts the KEY). Published content
// keeps the plain own-line token (markdown serialization below), so
// ZoneMarkdown / EmbedCard and every stored body are untouched; INSIDE the
// editor the token materializes as an atom node rendered by the EmbedNodeView
// react nodeview (RichTextEditor attaches it when `embedPicker` is set — this
// module stays React-free so the headless smoke test can exercise the real
// node + normalizer).
//
// Copy of components/polls/poll-embed-extension.ts: loaded/pasted/hand-typed
// own-line tokens at the document top level are REPLACED by the node — the
// plugin view's init microtask covers the initial parse, appendTransaction
// covers everything after, history transactions are skipped.

import { Node, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { NodeType, Node as PMNode } from '@tiptap/pm/model';
import { EMBED_KINDS, embedToken, isEmbedKind, normalizeEmbedRef, type EmbedKind, type EmbedRef } from '@/lib/zones/shared';
import type { EmbedData, ZoneAttachmentView } from '@/lib/zones/types';

/** Exact in-doc text form (escaping only exists in serialized markdown). */
const IN_DOC_TOKEN = new RegExp(`^\\[embed:(${EMBED_KINDS.join('|')}):([^\\n\\]]{1,512}?)\\]$`);

export const CONTENT_EMBED_NODE = 'contentEmbed';

/**
 * Local-first attachment lookup handed in by the editor: every saved
 * attachment (by row id AND storage key) plus the composer's unsaved drafts
 * (by key), so a `file` card renders from memory — no `/api/zones/embed`
 * round trip, and never a `not_found` for a key whose row does not exist yet.
 */
export interface ContentEmbedLocal {
  map: ReadonlyMap<string, ZoneAttachmentView>;
  zoneSlug: string;
}

/** What the in-editor 「预览」 button hands back to the editor (→ usePreview().open). */
export interface ContentEmbedPreviewTarget {
  kind: 'file';
  ref: string;
  title?: string;
  data?: EmbedData;
  via?: 'pointer' | 'keyboard';
}

/** Read through `props.extension.options` by the React nodeview (types only — this module stays React-free). */
export interface ContentEmbedOptions {
  getLocal?: () => ContentEmbedLocal;
  onPreview?: (target: ContentEmbedPreviewTarget) => void;
}

/** Parses a paragraph's text; null unless it is exactly a token with a valid ref. */
export function parseInDocEmbedToken(text: string): EmbedRef | null {
  const m = IN_DOC_TOKEN.exec(text.trim());
  if (!m || !isEmbedKind(m[1])) return null;
  const ref = normalizeEmbedRef(m[1], m[2]);
  return ref ? { kind: m[1], ref } : null;
}

function buildNormalizeTr(state: EditorState, type: NodeType) {
  const hits: { pos: number; size: number; kind: EmbedKind; ref: string }[] = [];
  state.doc.forEach((child: PMNode, offset: number) => {
    if (child.type.name !== 'paragraph') return;
    const parsed = parseInDocEmbedToken(child.textContent);
    if (parsed) hits.push({ pos: offset, size: child.nodeSize, kind: parsed.kind, ref: parsed.ref });
  });
  if (hits.length === 0) return null;
  const tr = state.tr;
  for (const h of hits.reverse()) {
    tr.replaceWith(h.pos, h.pos + h.size, type.create({ kind: h.kind, ref: h.ref }));
  }
  return tr;
}

export const ContentEmbedBase = Node.create<ContentEmbedOptions>({
  name: CONTENT_EMBED_NODE,
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { getLocal: undefined, onPreview: undefined };
  },

  addAttributes() {
    return {
      kind: {
        default: 'link',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-embed-kind') ?? 'link',
        renderHTML: (attrs: { kind?: string }) => (attrs.kind ? { 'data-embed-kind': attrs.kind } : {}),
      },
      ref: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-embed-ref') ?? '',
        renderHTML: (attrs: { ref?: string }) => (attrs.ref ? { 'data-embed-ref': attrs.ref } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-content-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-content-embed': '' }, HTMLAttributes)];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          const kind = String(node.attrs.kind ?? 'link') as EmbedKind;
          state.write(embedToken(kind, String(node.attrs.ref ?? '')));
          state.closeBlock(node);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        view: (view) => {
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            const tr = buildNormalizeTr(view.state, type);
            // `preventUpdate`: this is the LOADED content taking its in-editor
            // shape, not an edit — without it the editor emitted `update` on
            // mount, the composer's onChange replaced bodyMd with the
            // re-serialized text and a pristine post was "dirty" (autosave +
            // a 恢复 banner on the next visit) before anyone typed.
            if (tr) view.dispatch(tr.setMeta('preventUpdate', true));
          });
          return {};
        },
        appendTransaction: (trs, _old, newState) => {
          if (!trs.some((tr) => tr.docChanged)) return null;
          if (trs.some((tr) => tr.getMeta('history$'))) return null; // don't fight undo
          return buildNormalizeTr(newState, type);
        },
      }),
    ];
  },
});

/**
 * Inserts an embed node at the document TOP LEVEL. At the selection, a caret
 * inside a blockquote/list would nest it and the own-line token contract
 * would never match on render (same `$to.after(1)` rule as the poll embed).
 */
export function insertContentEmbed(editor: Editor, kind: EmbedKind, ref: string): void {
  const { $to } = editor.state.selection;
  const pos = $to.depth === 0 ? $to.pos : $to.after(1);
  editor
    .chain()
    .focus()
    .insertContentAt(pos, [
      { type: CONTENT_EMBED_NODE, attrs: { kind, ref } },
      { type: 'paragraph' },
    ])
    .run();
}
