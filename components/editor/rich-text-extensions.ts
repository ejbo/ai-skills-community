// The ONE extension list every rich-text editor in the app is built from.
//
// components/RichTextEditor.tsx calls this with its React node views; the
// headless tests (tests/editor-*.test.ts, tests/mention-editor.test.ts,
// tests/rich-marks.test.ts, tests/rte-table.test.ts, tests/rte-stack.test.ts)
// call it WITHOUT them. Before this module each test carried a hand-copied list,
// and the copies drifted from the shipped stack — which is how the missing
// block-image closeBlock, and the untested combination of the formatting marks
// with the flow serializer, went unnoticed. React-free on purpose: nothing here
// may import a component, next-intl or the DOM beyond what tiptap itself needs.
//
// ORDER CONSTRAINTS (each one pinned by a test):
//   • StarterKit ships `code` and `codeBlock` OFF. InlineCode (format-marks.ts)
//     and CodeBlockBase (code-block-extension.ts) replace them under the same
//     names; two marks / nodes with one name is either a schema error or a
//     silent hybrid.
//   • TABLE_EXTENSIONS BEFORE MentionSuggestion: same-priority plugins run in
//     REVERSE registration order, so the @人 popup sees Enter / arrows before a
//     table cell's line-break and arrow-out keys (tests/mention-editor.test.ts).
//   • Marks: array position does not matter, PRIORITY decides the schema rank
//     and therefore the nesting of the stored markdown (format-marks.ts header).
//   • Markdown, then FlowExtension LAST: the flow serializer swaps
//     tiptap-markdown's serializer state after tiptap-markdown has created it.
//     FlowMarkdownParse (flow-parse.ts) only contributes a markdown-it setup and
//     a paste transform, so its position does not matter.
//
// Every editor instance must register the same list: opening a body in an
// editor that lacks a mark or node silently drops it on the next save.

import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { CodeBlockBase } from '@/components/editor/code-block-extension';
import { FlowExtension } from '@/components/editor/flow-extension';
import { FlowMarkdownParse } from '@/components/editor/flow-parse';
import { BasePathImage, StickerImageNode } from '@/components/editor/flow-image';
import { FORMAT_MARK_EXTENSIONS } from '@/components/editor/format-marks';
import { TABLE_EXTENSIONS } from '@/components/markdown-table';
import { MentionSuggestion, type MentionSuggestionOptions } from '@/components/mention/mention-suggestion';
import { PollEmbedBase, type PollEmbedOptions } from '@/components/polls/poll-embed-extension';
import { ContentEmbedBase, type ContentEmbedOptions } from '@/components/zones/embeds/embed-node-extension';
import { FileUploadPlaceholder, type FileUploadPlaceholderOptions } from '@/components/zones/embeds/file-upload-plugin';

/** The markdown options every editor parses and serializes with. */
export const RICH_TEXT_MARKDOWN_OPTIONS = { html: true, transformPastedText: true, breaks: false } as const;

/** The link options every editor uses (autolink ON is what makes the Link mark inclusive — tests/mention-editor.test.ts). */
export const RICH_TEXT_LINK_OPTIONS = {
  openOnClick: false,
  autolink: true,
  HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
} as const;

export interface RichTextExtensionOptions {
  placeholder?: string;
  mention?: Partial<MentionSuggestionOptions>;
  poll?: Partial<PollEmbedOptions>;
  /** 技术专区 `[embed:…]` cards. Omitted / false ⇒ the node is not registered. */
  embed?: Partial<ContentEmbedOptions> | false;
  /** In-body file upload placeholders (needs `embed`). Omitted / false ⇒ not registered. */
  upload?: Partial<FileUploadPlaceholderOptions> | false;
  /** Syntax colouring inside code blocks while writing (default on; lazy highlight.js). */
  codeHighlight?: boolean;
  /**
   * Node-view-backed variants of the three nodes that have a React view. The
   * editor passes `CodeBlockWithView` / `PollEmbedWithView` / `ContentEmbedWithView`;
   * tests leave them out and get the React-free bases — same name, schema,
   * markdown contract and commands, only the DOM differs.
   */
  views?: {
    codeBlock?: typeof CodeBlockBase;
    pollEmbed?: typeof PollEmbedBase;
    contentEmbed?: typeof ContentEmbedBase;
  };
  /**
   * TESTS ONLY: `false` builds the stack without FlowExtension, as the reference
   * that the flow serializer must stay byte-identical to (tests/editor-flow.test.ts).
   */
  flow?: boolean;
}

export function buildRichTextExtensions(options: RichTextExtensionOptions = {}): AnyExtension[] {
  const { views = {} } = options;
  const extensions: AnyExtension[] = [
    StarterKit.configure({ code: false, codeBlock: false }),
    Link.configure(RICH_TEXT_LINK_OPTIONS),
    ...TABLE_EXTENSIONS,
    MentionSuggestion.configure(options.mention ?? {}),
    BasePathImage,
    StickerImageNode,
    (views.codeBlock ?? CodeBlockBase).configure({ highlight: options.codeHighlight ?? true }),
    ...FORMAT_MARK_EXTENSIONS,
    (views.pollEmbed ?? PollEmbedBase).configure(options.poll ?? {}),
  ];
  if (options.embed) extensions.push((views.contentEmbed ?? ContentEmbedBase).configure(options.embed));
  if (options.embed && options.upload) extensions.push(FileUploadPlaceholder.configure(options.upload));
  // FlowMarkdownParse is PARSE-side (soft breaks, own-line tokens, pasted
  // `<p><img>`) and so is registered with or without FlowExtension: the flow:false
  // reference stack must read a body the same way to be a reference at all.
  extensions.push(Placeholder.configure({ placeholder: options.placeholder ?? '' }), FlowMarkdownParse, Markdown.configure(RICH_TEXT_MARKDOWN_OPTIONS));
  if (options.flow !== false) extensions.push(FlowExtension);
  return extensions;
}
