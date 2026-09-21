# 富文本编辑器、表情包、投票组件 (RichTextEditor)

> 从 CLAUDE.md 拆出。改编辑器前必读——v2/v3 的每条契约都是承重的。

- **富文本编辑器 v2 (2026-09-14, NO migration) — 继续书写、文字样式、代码块、任意附件、帖子可编辑.** Owner:
  「粘贴或插入表格/图片后无法切换到下一行」「文字颜色、背景色、选中文字变行内代码、字号字体」「附件支持 json、py、各类文件，
  能预览就预览，不能就下载」「技术专区发完的帖子要能再次编辑」「code block 参照 aceternity code-block」. It touches every
  `RichTextEditor` surface (发帖/Wiki/话题/活动/视频描述/公告/Skill/评论…). Contracts, each load-bearing:
  - **ONE extension list**: `components/editor/rich-text-extensions.ts#buildRichTextExtensions(opts)` (React-free).
    `RichTextEditor` passes its React node views through `views`; tests build the SAME list — never hand-copy an
    extension array into a test again (six copies had drifted, one with the table/mention order reversed). Order is
    load-bearing: `StarterKit.configure({ code: false, codeBlock: false })`, Link, `TABLE_EXTENSIONS` BEFORE
    `MentionSuggestion` (the @ popup must get Enter inside a cell), images, CodeBlock, format marks, poll, embed/upload,
    Placeholder, Markdown, `FlowExtension` last.
  - **Flow (`components/editor/flow-*.ts`)**: (1) the block-image serializer calls `state.closeBlock(node)` (skipped when
    `node.isInline` — stickers). Before this EVERY block after an image was glued onto the image line (`![](x)## H`) and a
    second save flattened tables/headings/code for good; `pnpm content:repair-glued-images` (dry-run by default,
    `--apply` to write, `lib/glued-images.ts`) finds and repairs rows written by the old serializer — run it on
    production. (2) A trailing-paragraph `appendTransaction` with `addToHistory:false`: a pristine editor emits 0
    updates and `can().undo()` is false; the poll/embed normalizers are `addToHistory:false` too (Undo used to turn
    cards back into tokens), and the value-sync effect skips its first run per editor instance. (3) One placement rule
    for block inserts (`flow-insert.ts#placeBlockNode`): the author's empty line is kept, a paragraph always follows,
    blocks never land in a cell; image uploads use insert BATCHES with mapped positions so N parallel uploads all land.
    (4) A NodeSelection on a block atom + typing/IME/Enter opens a paragraph after it instead of replacing the node.
    (5) Tables: Enter/Shift-Enter in a cell = hard break stored as `<br>` (the table stays GFM — a split cell used to
    silently turn the whole table into raw HTML); Mod-Enter / ArrowDown on the last row / ArrowRight at the last cell
    leave the table; the strip has 上方/下方加段落 and stays MOUNTED (hidden) while the doc has a table so the page does not
    jump; `isGfmTable` accepts only one-paragraph cells (anything richer takes the raw-HTML path intact) and column
    alignment round-trips. (6) The gap cursor is a visible full-width 2px line; clicking below the last block lands in
    the trailing paragraph; the block image wrapper keeps its prose margins OUTSIDE the hit box. (7)
    `flow-markdown.ts` replaces tiptap-markdown's serializer state so emphasis delimiters never move across `[ ] ( )`,
    another delimiter kind, a surrogate half/ZWJ/combining mark — else `**看[文档](/x**)` corrupted links and bold
    mentions; when a run cannot be valid markdown it is written as `<strong>/<em>/<del>`. (8) `flow-parse.ts`: soft
    breaks parse as a space (no more `codeis` gluing), own-line `[poll:]`/`[embed:]` tokens are isolated into their own
    block before parsing, pasted HTML images are lifted out of `<p>` with width/height/style dropped. (9)
    `unsupported-markdown.ts` warns when a body holds constructs the schema cannot keep (linked images, images in list
    items, task lists, footnotes, raw HTML) — opening and saving such a body still loses them.
  - **文字样式 = four custom marks** (`components/editor/format-marks.ts`, NO `@tiptap/extension-text-style` — it is not
    importable under pnpm strict): textColor / textBg / fontSize / fontFamily stored as `<span data-color|data-bg|
    data-size|data-font="v">` with CLOSED value sets from `lib/rich-marks.ts` (the single contract the marks, the
    sanitize schema, the palette CSS and the plain-text helpers all read). Priority 1001–1004 — ABOVE Link: at 100 bold+CJK
    corrupts, at 101 a coloured @mention stops extracting (no notification). Never store `style=`, class names or raw
    colours (sanitize cannot restrict CSS per property; raw colours cannot follow the themes). parseHTML accepts only our
    span shape, so pasted Word/web colours come in as plain text; a guard plugin strips invalid values. `InlineCode`
    (replaces StarterKit's `code`) coexists with the four formats and links but still refuses bold/italic/strike (probed:
    corrupts saved code next to CJK) and refuses code over a mention. UI = the v3 toolbar (below), portaled, moving off
    the selection it formats (`avoid-selection.ts`), `tone="reader"` auto-detected inside `.reader-root`. Palette =
    `app/rich-text.css` RGB tokens for light/dark AND the 知识库 reader themes (`lib/rich-text-ground.ts` decides which
    ground a surface paints on).
  - **v3 (2026-09-15, NO migration) — 全量工具栏 + 插入引用浏览器.** Owner: 「字体选择、字号、颜色和背景色作出四个分开的…全量的」
    「行高」「格式刷」「插入和编辑链接」「上标和下标」「清除格式」「@ 提及别人」「引用不用非要加引号」「插入引用…按时间和热度排序,
    优先显示自己发布的, 可以插入自己收藏的, 支持滚动加载, 主要显示标题而不是代号」. The v2 contracts above all still hold; v3 only
    widens them.
    - **Storage stays `lib/rich-marks.ts`, value sets WIDENED, legacy values valid forever**: `data-color`/`data-bg` take
      the 9 named values + lowercase `#rrggbb`; `data-size` takes `sm|lg|xl` + a bare px NUMBER (`data-size="24"`, never
      `24px`) from `RICH_FONT_SIZES_PX`; `data-font` takes `serif|kai|mono` + the CJK/Latin keys in
      `RICH_FONT_FAMILY_STACKS` (system stacks only — the intranet loads no web fonts). 上标/下标 are plain
      `<sup>`/`<sub>` at priority **1005**, outermost of every inline mark (so they nest outside colour spans, links,
      bold and code), mutually exclusive, and a selection edge inside a mention widens to the whole mention.
    - **行高 is a BLOCK attribute, not a mark**: `components/editor/line-height.ts` on top-level paragraph / heading /
      list / blockquote, serialized by `flow-markdown.ts#serializeTopLevelBlocks` — each RUN of consecutive blocks with
      the same value is wrapped in `<div data-lh="2">` + blank lines, which is what keeps the markdown inside it real
      markdown (headings still reach the TOC, @mentions still extract). Runs break at every block that cannot carry it
      (code, table, image, hr, poll/embed cards); the command is disabled in table cells; a value that lands below the
      top level (paste into a list item) is stripped, and that strip IS in history so undo restores it.
    - **Hex colours are never stored as `style=`**: `lib/markdown-rich-style.ts` is a rehype plugin that runs AFTER
      rehype-sanitize (same trick as `lib/markdown-code-lines.ts`) and turns a re-validated hex `data-color`/`data-bg`
      into `--rt-c` / `--rt-bg`; `app/rich-text.css` paints them, clamping OKLCH lightness from BOTH sides (a floor on
      dark grounds, a ceiling on light and 护眼 grounds — a user-picked #ffff00 must stay legible either way) and giving a
      hex background an automatic contrasting text colour. The editor's `renderHTML` emits the same property, so both
      sides share one set of rules — but that editor-only `style` is stripped at the one door where editor HTML becomes
      stored markdown (`stripEditorHexStyle`, the raw-HTML table fallback used to leak it into the body). Swatches in the
      palette carry `.rte-swatch` + the same custom property, so a swatch can never show a colour the page will not paint.
      引用 no longer gets Tailwind Typography's `open-quote`/`close-quote` in `.prose` or `.rte-content`.
    - **@提及 survives formatting**: `lib/mentions.ts` matches `[**@名字**](/users/x)` (emphasis delimiters around the
      label — B/I/S and the format painter produce it) and the `<a href="/users/x">@名字</a>` shape the editor writes
      inside a raw-HTML table, merged in document order. Formatting a mention must never silently drop its notification.
    - **Nesting guard**: `MARKDOWN_MAX_NESTING_DEPTH` / `exceedsNestingDepth` (`lib/markdown-text.ts`) — a ~1.5 KB body of
      deeply nested quotes/lists/HTML used to overflow React's SSR stack and take the whole page down for every viewer.
    - **The toolbar is `components/editor/toolbar/EditorToolbar.tsx`** (full + compact variants), NOT the deleted
      `TextStyleMenu`: 字体 / 字号 / 文字颜色 / 背景色 are four separate controls, plus 行高, 格式刷, 插入/编辑链接,
      上标/下标, 清除格式 and @提及. ONE popover mechanism (`toolbar/primitives.tsx#useToolbarPanel` = `useAnchoredPanel`
      + `avoid-selection` + Esc back to the editor + the reader host); palette data and the per-browser recent colours in
      `toolbar/palette.ts`; 插入/编辑链接 in `toolbar/link-edit.ts` + a caret bubble + ⌘K (a plugin LinkControls
      registers on the live editor, since the dialog is React; it stops the event so the site's ⌘K palette stays shut) —
      `normalizeLinkHref` accepts http(s), a bare host, `mailto:`, a `#锚点` and ONE-leading-slash site paths, never
      `javascript:`, `//host`, `/\host` (mailto and #anchor because the editor MAKES those links itself: refusing them
      meant the dialog could not edit its own); 格式刷 in `components/editor/format-painter.ts`, whose armed state is
      PLUGIN state read through `formatPainterState` and which disarms on `focusout` (Esc never reaches it from the title
      field) and waits out the double→triple click window before a one-shot paint. 撤销/重做 are in BOTH variants (a
      touch device has no Mod-Z); below `sm` the full row REORDERS with `max-sm:order-*` so a phone opens on 加粗, not on
      撤销; the 表格条 is an OVERLAY under the toolbar box (`s.inTable` only), never a reserved band. Every control
      carries `data-rte-control` — **find them by that, never by translated text.**
    - **The editor host does not re-render per transaction**: `useEditor({ shouldRerenderOnTransaction: false })`, and
      the toolbar subscribes through `useEditorState` with TWO gates (EditorToolbar#useToolbarState) — the snapshot is
      recomputed only when (doc, selection, storedMarks, painter, focus, editable) moved, and a recomputed snapshot with
      the same VALUES keeps the previous object (`sameToolbarState`), so typing a word commits nothing. That is not a
      micro-optimisation: react-dom saves and restores the selection around every commit by walking the whole focused
      contenteditable (~3 ms a keystroke on a long post). Anything that must follow the caret subscribes for itself
      while it is on screen (`useToolbarPanel`, the link bubble); nothing in the toolbar tree may read `editor.state`
      at render and expect a re-render. Popovers keep the keyboard too: ↑/↓ after a mouse open move INTO the panel, and
      Tab wraps in a dialog / closes a menu instead of walking out of the portal onto page chrome.
    - **插入引用 is a paged browser** (`lib/zones/embeds.ts#searchEmbedCandidates`, cursor contract in
      `lib/zones/embed-search-shared.ts`): per-kind 全部 / 我发布的 / 我的收藏 scopes + 最新 / 最热 sort, keyset paging
      behind an IntersectionObserver in `EmbedPickerDialog`, rows showing the TITLE (no ids/codes) + 更新于. 全部 is
      `mine` then `rest` phases that PARTITION one gated set, and every phase ANDs the kind's own gate first (the same
      `canReadDoc` / `DISCOVERABLE_SKILL_WHERE` / zone-post rules as before — an embed picker may never widen what a
      viewer can see). Never sort or date a row by Prisma's `@updatedAt` — a like or a view bumps it; each kind's
      「更新于」 and 最新 order come from its own publish / 入库 / release time (the table at the top of that file).
  - **`lib/markdown.ts` closed the arbitrary-class hole**: `span`/`code`/`pre` className used to accept ANY value, so a
    body posted through the API could render `<span class="fixed inset-0 z-[100]">` as a full-page overlay link. span now
    keeps only highlight.js token classes + the four data attributes with enumerated values; code keeps
    `language-*`/`hljs`; pre takes none. Do not widen it back.
  - **Plain text & limits**: every excerpt/notification/search/heading-id sink goes through `lib/markdown-text.ts`
    (`markdownToPlainText`, `markdownInlineToPlainText`, `richTextLength`, `stripRichFormatting`, `htmlMarkupIn`) — real
    tags only (`a < b > c` survives), entities decoded, code-only bodies fall back to their first code line.
    `extractHeadings` uses `headingPlainText` so server ids match the client's textContent ids. Length caps on
    RichTextEditor fields count VISIBLE length: server `withRichTextLimit(z.string(), N)` (`lib/rich-text-limit.ts`, raw
    ceiling ×4) and client `isRichTextTooLong` — the editor counter uses the same function, so a comment the client
    allows can never 400. SKILL.md fallback bodies and AI contexts use `stripRichFormatting`. 技术专区 `summary`: an auto
    excerpt is no longer frozen on first save (`lib/zones/post-summary.ts#nextPostSummary`).
  - **代码块 = Aceternity Code Block look** (owner reference): dark slate-900 panel in BOTH themes, header = filename or
    language + copy (Check for 2 s), line numbers, `{1,3-5}` highlighted lines. Reader: `lib/markdown-code-lines.ts`
    rehype plugin runs AFTER sanitize (so it needs no schema entry) and rebuilds frame attributes from validated values
    only; fence meta is recovered by source offset because rehype-raw drops `code.data.meta`; `measureCodeLines` bounds
    the split work (the naive splitter was breaks × depth — one small body could stall the single server process);
    over budget = plain frame without numbers. `components/code/CodeFrame.tsx` (reader) and `CodeBlock.tsx` (raw code,
    file preview) share the frame; highlight.js comes from `lib/hljs-client.ts#getHljs()` (the SAME core + 37 grammar
    modules rehype-highlight already bundles — never `import('highlight.js/lib/common')`, that shipped a second copy);
    NO auto-detect (plain .txt/.log were painted as YAML/SQL). Editor: `code-block-extension.ts` + `CodeBlockView.tsx`
    (language select, filename input, copy, decoration highlighting only when an edit touches code, Enter keeps
    indentation, Tab = 4 spaces for python else 2); the original fence info string is kept verbatim in `rawInfo` until
    language/filename/highlight change.
  - **任意附件**: `lib/files/file-types.ts` is THE table (key ext `safeKeyExt` = `[a-z0-9]{1,10}` else `bin`, MIME only a
    hint — most source files arrive with an EMPTY type and .svg arrives as image/*; `serveClassOf`, `contentTypeFor`,
    `previewClassOf`, `languageForExt`, `DANGEROUS_EXTS` = warning, not a block). Every key regex (`ZONE_MEDIA_KEY_RE`,
    `EMBED_FILE_KEY_RE`, `lib/uploads/post-media-keys.ts`) is built from `SAFE_KEY_EXT_PATTERN` — widen them TOGETHER or
    re-editing a post drops the row and unlinks the file. Decisions read the KEY's extension, never the display name.
    Serving = `lib/uploads/serve.ts` for zone AND discussion media: real Content-Type only for raster image / mp4-webm-mov
    / audio / PDF (inline); html/svg/xml/js/code → `text/plain`, everything else octet-stream, both `attachment` +
    `CSP: sandbox` + `CORP: same-origin` (never on PDF); nosniff always; the download name gets the key's extension forced
    on (`?name=run.bat` on a .py key → `run.bat.py`). The X-Accel handoff drops app headers, so
    `deploy/ai-community.nginx.conf` re-adds them via `map $uri` (a test pins the map to the table) — **reload nginx after
    deploying** (pitfall #3: `kill -HUP`, never systemctl). Zone upload route has `hasFreeSpace()` now. Preview =
    `components/files/FileViewer.tsx` (surface-neutral, lazy): code/text via CodeBlock (first 1 MiB by Range, NUL sniff,
    UTF-8 → GB18030 fallback), JSON pretty, CSV table (200 rows per page, 50 cols), markdown rendered/source,
    html/svg/xml SOURCE only, office via the host's node, everything else ONE 不支持预览 card + ink 下载. 讨论区 uses it in
    `FileViewerDrawer`. 打开原页面 is offered only when `opensInBrowser(key)` (a download-served file would just download).
  - **帖子编辑入口**: `lib/zones/post-edit.ts#canViewerEditZonePost` wraps the same `canEditZonePostContent` the PATCH
    route enforces and is the ONE check for the edit page, the header 编辑 button (published posts; drafts have the
    banner's 继续编辑), the action bar 编辑 pill and PostRow's author link. The ⋯ trigger had `px-3.5` beating `px-0`
    (dots squeezed invisible) and the bar was `lg:static` inside a blur stacking context (menu painted UNDER the
    comments) — keep `pillBase` padding-free and the bar `lg:relative`.
  - **Phone navbar**: below `sm` the right cluster no longer overflows (it made the layout viewport 415 px on a 390 px
    phone, clipping every right-anchored popover/drawer); 主题 and 语言 move into `NavMoreMenu` there, and
    `useAnchoredPanel` clamps to `visualViewport`.
  - Known, deliberately not done: pasted external (hotlinked) images are kept as external links (re-hosting needs an
    egress route — owner decision); zip entry listing / ipynb cells; search still ILIKEs raw bodies (markup words can
    match); 意见反馈 has no author edit and shorts have no caption-edit UI.
- **表情包 (Stickers, migration `20260807150000_add_stickers_polls`)**: WeChat-style personal
  meme library, ONE integration pair — the 😊 button in `RichTextEditor`'s toolbar (every
  composer gets it) and a src-prefix branch in `MarkdownRenderer`. `UserSticker` = per-user
  rows over SHARED files in the `stickers/` namespace of the uploads root (public
  `/api/uploads/[...key]` serves them for free); the URL prefix `/api/uploads/stickers/`
  (lib/stickers.ts) IS the render-time trust signal — test the RAW stored src BEFORE
  withBasePath. Files are NEVER unlinked on row delete (old messages keep rendering; same
  policy as editor images). Rendered-sticker interactions (`StickerImage`): CLICK = enlarge
  in the shared `ImageLightbox` (its optional `actions` slot carries 添加到表情包 — that is
  also the touch path), RIGHT-CLICK = cursor-anchored 添加到表情包 menu; the Toaster sits at
  z-[120] ON PURPOSE so toasts fired from inside the z-[100] lightbox stay visible.
  添加到表情包 (`POST /api/stickers/add`) re-validates the
  client-sent key against `STICKER_KEY_RE` + on-disk existence — never trust the URL; dedupe
  via the `(userId, fileKey)` unique. Panel (`StickerPicker`, portaled — editor root is
  overflow-hidden): bottom tabs 最近/全部/收藏 derive from `lastUsedAt`/`favorited`
  client-side; uploads are sequential single-file raw-body POSTs (house protocol); hover
  preview card carries 红心/删除 (touch = 450ms long-press). In-editor stickers are an INLINE
  `stickerImage` node extending `BasePathImage` — its `addCommands` MUST stay `{}` (an
  inherited `setImage` would hijack normal image inserts) and `parseHTML` priority 100 claims
  the prefix; tiptap-markdown lifts it to its own paragraph on RE-EDIT (known cosmetic
  tradeoff, readers still see it inline). Mechanism contract is pinned by
  `tests/editor-embed-smoke.test.ts` — mirror changes there.
- **投票 (Polls, same migration)**: standalone `Poll`/`PollOption`/`PollVote` created from the
  editor's 📊 dialog, then embedded as an own-line `[poll:<id>]` token; `lib/polls-shared.ts`
  is the SINGLE token contract (≤3 leading spaces, fence-aware splitter — a token inside
  ```/~~~ stays inert text, ≤`MAX_POLLS_PER_CONTENT` widgets per body, duplicate ids inert)
  and `MarkdownRenderer` mounts `PollWidget` per segment (key includes the poll id — index
  alone leaves stale state on edits). IN-EDITOR the token materializes as the `pollEmbed`
  atom node (`components/polls/poll-embed-extension.ts` — React-free base with the
  markdown serializer + a normalizer that converts loaded/pasted own-line tokens; initial
  normalize runs in the plugin view's microtask because tiptap's `create` event is async);
  `RichTextEditor` attaches the `PollEmbedView` nodeview (preview card + 编辑/移除) and
  inserts new polls at the document TOP LEVEL (`$to.after(1)`) — at the selection, a
  blockquote caret would nest the token and the own-line matcher rightly ignores it
  (orphaned poll). Voting is replace-all + RECOUNT from
  `PollVote` rows inside a Serializable tx with P2034 retries (no increment drift);
  `resultsAfterVote` gates counts SERVER-side (`voteCount: null`) and blocks retraction
  (vote-then-retract = free results peek); voter identities need login + non-anonymous
  (per-option earliest-20 through `toPublicAuthor`). `GET /api/polls/[id]` is anonymous
  (polls embed in public content) but rate-limited by userId / last-XFF-hop IP. `excerptOf`
  strips tokens via `POLL_TOKEN_GLOBAL_RE`; PostCard's clamp measurement uses a
  ResizeObserver because widgets grow after mount. Editing: creator/admin may PATCH the full
  definition ONLY while `voterCount === 0` (re-checked inside the tx — `poll_has_votes`;
  options replaced wholesale); after votes, only 提前结束. The composer dialog doubles as
  the editor (`pollId` prop) and broadcasts `POLL_UPDATED_EVENT` (lib/polls-shared.ts) so
  mounted previews refetch. Deleting the embedding content orphans the poll — accepted.
