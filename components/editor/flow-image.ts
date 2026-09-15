// The house editor's two image nodes — moved out of components/RichTextEditor.tsx
// so the headless tests (tests/editor-flow.test.ts, editor-embed-smoke,
// mention-editor) exercise the SHIPPED serializer and node view instead of a
// hand-copied replica. React-free on purpose: the node view is plain DOM.
//
// - `image` (BasePathImage): a BLOCK atom. basePath is applied to the DISPLAYED
//   src only (stored attrs stay root-relative + portable), it carries a `width`
//   attribute set by drag-to-resize, and its markdown persists that width as an
//   HTML <img> — plain `![](…)` cannot carry a size, and MarkdownRenderer already
//   renders <img width> (sanitizeSchema allows it). Without a width it stays
//   normal markdown.
// - `stickerImage` (表情包): the same node made INLINE, so stickers sit in the
//   text flow, several per line.

import { mergeAttributes } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { withBasePath } from '@/lib/base-path';
import { STICKER_URL_PREFIX } from '@/lib/stickers';

const escAttr = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Class on a BLOCK image's node-view wrapper (stickers never carry it). */
export const RTE_BLOCK_IMAGE_CLASS = 'rte-img-block';

export const BasePathImage = Image.extend({
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
          // A BLOCK image must END its block. Without this the serializer wrote
          // whatever followed straight onto the image's line — `![a](/a.jpg)## H`,
          // `![a](/a.jpg)[embed:file:…]` — and CommonMark reads that as ONE
          // paragraph: headings, lists, quotes and tables after an image showed up
          // as literal text in the reader, an embed / poll token stopped being an
          // own-line token (the card vanished, bodyFileKeys lost the file), and the
          // next open + save escaped the lost structure for good (`\## H`). Every
          // other block atom (poll, embed, table) already closes its block.
          // Stickers inherit this serializer but are INLINE — closing their
          // "block" would break the sentence they sit in, so they are skipped.
          if (!node.isInline) state.closeBlock(node);
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
      // A block image's wrapper is a BLOCK box that hugs the picture
      // (RTE_BLOCK_IMAGE_CLASS, styled in RichTextEditor): the prose margins
      // live on the wrapper's OUTSIDE, so the atom's hit box is exactly the
      // picture. They used to sit inside an inline-block wrapper, which made
      // the 2 em under a trailing image part of the image — a click "just
      // below" re-selected it and the next keystroke replaced it.
      wrap.className = isSticker ? 'rte-img rte-sticker' : node.type.isInline ? 'rte-img' : `rte-img ${RTE_BLOCK_IMAGE_CLASS}`;

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
// serializer (stickers never carry width ⇒ plain `![alt](src)`, and no
// closeBlock because the node is inline), and attrs. parseHTML priority 100
// beats the block image's generic img[src] rule, so stored
// `![sticker](/api/uploads/stickers/…)` markdown re-opens as this node.
export const StickerImageNode = BasePathImage.extend({
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
