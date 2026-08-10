// In-editor 投票 embed node — the editor-side half of the `[poll:<id>]` token
// contract (lib/polls-shared.ts). Published content keeps the plain own-line
// token (markdown serialization below), so MarkdownRenderer/PollWidget and all
// stored bodies are untouched; INSIDE the editor the token materializes as an
// atom node rendered by the PollEmbedView react nodeview (RichTextEditor
// attaches it — this module stays React-free so the headless smoke test can
// exercise the real node + normalizer).
//
// Normalization: loaded/pasted/hand-typed own-line `[poll:<id>]` paragraphs at
// the document top level are REPLACED by the node — the plugin view's init
// microtask covers the initial parse (no transaction fires then, and tiptap's
// `create` event is emitted asynchronously so it can't be relied on either),
// appendTransaction covers everything after. History transactions are skipped
// so undo doesn't fight the normalizer.

import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import type { NodeType, Node as PMNode } from '@tiptap/pm/model';

/** Exact in-doc text form (escaping only exists in serialized markdown). */
const IN_DOC_TOKEN = /^\[poll:([a-z0-9]{8,40})\]$/;

export interface PollEmbedOptions {
  /** Called when the nodeview's 编辑 affordance is clicked. */
  onEdit: (pollId: string) => void;
}

function buildNormalizeTr(state: EditorState, type: NodeType) {
  const hits: { pos: number; size: number; id: string }[] = [];
  state.doc.forEach((child: PMNode, offset: number) => {
    if (child.type.name !== 'paragraph') return;
    const m = IN_DOC_TOKEN.exec(child.textContent);
    if (m) hits.push({ pos: offset, size: child.nodeSize, id: m[1] });
  });
  if (hits.length === 0) return null;
  const tr = state.tr;
  for (const h of hits.reverse()) {
    tr.replaceWith(h.pos, h.pos + h.size, type.create({ pollId: h.id }));
  }
  return tr;
}

export const PollEmbedBase = Node.create<PollEmbedOptions>({
  name: 'pollEmbed',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { onEdit: () => {} };
  },

  addAttributes() {
    return {
      pollId: {
        default: '',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-poll-id') ?? '',
        renderHTML: (attrs: { pollId?: string }) =>
          attrs.pollId ? { 'data-poll-id': attrs.pollId } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-poll-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-poll-embed': '' }, HTMLAttributes)];
  },

  addStorage() {
    return {
      markdown: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialize(state: any, node: any) {
          state.write(`[poll:${node.attrs.pollId}]`);
          state.closeBlock(node);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        // Initial-content normalization: no transaction fires for the parse at
        // editor creation, so appendTransaction alone misses loaded content.
        // The plugin view's constructor runs synchronously at view creation;
        // the dispatch is deferred a microtask because dispatching from inside
        // the view-construction phase is not allowed.
        view: (view) => {
          queueMicrotask(() => {
            if (view.isDestroyed) return;
            const tr = buildNormalizeTr(view.state, type);
            if (tr) view.dispatch(tr);
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
