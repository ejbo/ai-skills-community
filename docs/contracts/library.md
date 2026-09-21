# 知识库 (Library, /library)

> 从 CLAUDE.md 拆出。LLM/推理模型的通用坑见 platform.md。

- **知识库 (Library)**: Readwise-style reading library at `/library` (migrations
  `20260729120000_add_library` + `20260729150000_extend_library`). Users submit URL/PDF/EPUB (NO
  size cap by design) → `lib/library/` extracts to chaptered sanitized HTML + chunks
  (chunkKey `c{ch}-{ord}`, 0-based; only the retrieve PROMPT is 1-based) → AI reads ONCE
  (per-chapter summaries + 导读, cached on rows, ≤120 chapters, checkpoint-resumable) → shared
  two-stage retrieval chat with `[cX-Y]` citations. Non-obvious invariants: chat citations ride
  the FIRST SSE frame `{"citations":[...]}` (a header would blow nginx `proxy_buffer_size`);
  `fetch-url.ts` has an SSRF guard with MANUAL per-hop redirect validation (RFC1918 allowed only
  when `ENABLE_SSO`); WeChat images need the lazy `data-src` promotion in `extract-html.ts` and
  are RE-HOSTED locally at ingest (mmbiz blocks hotlinks); EPUB entries stream with zip-bomb
  caps. Visibility mirrors skills (public/restricted/private + `LibraryAccessRequest`); uploader
  edits at `/library/<slug>/edit` set `metaPinned`/`categoriesPinned` so re-extraction/AI never
  overwrite. 细分类 = fixed taxonomy in `lib/library/types.ts` (LIBRARY_CATEGORIES) — don't switch
  to free tags. 评论 copies the feedback thread contract; 评分 recomputes avg in a transaction.
  Shared reading notes = per-user-per-doc `LibraryProgress.shareNotes`. Admin AI
  override lives in `LibrarySetting` via `getLibraryProvider()` (/manage/library), falling back
  to env `LLM_*`. **PDF 原版 view** = the browser's own `<iframe>` viewer (pixel-faithful, reliable
  zoom/selection, NO annotation — that lives in 精读). PDF opens in 原版 by default; 精读 is the
  toggle, and any TOC/citation/note jump switches to it. `LibraryChapter.pageStart/pageEnd`
  (0-based inclusive, PDF only) record the chapter↔page span. Uploaded `.html` is served
  `text/plain` from the file route (rendering stored user HTML on-origin = XSS). 选中翻译 via
  `/api/library/translate` (中↔英 auto-direction, LLM).
  - **`ReaderContent` MUST memoize the `dangerouslySetInnerHTML` OBJECT, not just the string**
    (`const inner = useMemo(() => ({ __html: … }), [html])`). React 18.3's `updateProperties` diffs
    props by IDENTITY (`nextProp !== lastProp`) and then calls `setInnerHTMLImpl` unconditionally —
    it never compares `__html`. A fresh `{ __html }` literal per render therefore rebuilt every
    child of the `<article>` on EVERY re-render, including every scroll frame (progress tracking
    sets state per frame). That single line was the root cause of the whole multi-round reader
    saga: text could not be selected (the nodes under the pointer were replaced mid-drag),
    highlights "flashed and disappeared", and anchored Ranges silently detached so the browser
    painted nothing. Confirmed in Chrome by trapping the `innerHTML` setter — it fired from
    React's `commitUpdate` right after mouseup. Do not "simplify" it back to an inline literal.
    (`CodeViewer.tsx` and `app/skills/[slug]/FilesTab.tsx` still have the inline form — same latent
    bug, lower stakes.)
  - **译文 (migration `20260824120000_library_translation_cache`)**: ONE shared cache,
    `LibraryTranslation(docId, targetLang, sourceHash → text)`, keyed by the hash of the
    WHITESPACE-NORMALIZED source — so a DOM selection and a stored HTML block hit the same row, a
    passage is paid for ONCE for the whole community, and the whole-document pass fills exactly the
    rows on-demand selection-translate reads. Direction is fixed per doc (`targetLangFor`: 中文 doc
    → English, otherwise → 中文). `POST /api/library/translate` is cache-first and answers a hit
    WITHOUT touching the model or the rate limiter. The whole-doc pass (`lib/library/translate-doc.ts`)
    runs automatically after indexing only under `LIBRARY_AUTO_TRANSLATE_MAX_CHARS` (default 40k —
    articles are ready before anyone opens them, books wait for a reader to click 翻译全文, which is
    `POST /api/library/docs/[id]/translate` and ignores the cap). It translates LEAF BLOCKS and
    rebuilds the chapter through `applyBlockTranslations`, which writes each translation with
    `textContent` — so no model output is ever parsed as markup, tables/figures/images survive, and
    `<pre>/<code>` is never sent to a translator. Partial coverage is fine: untranslated blocks keep
    the original. **译文 mode hides highlights** — marks anchor to the ORIGINAL character offsets.
  - **知识库分类 live in `LibraryCategory`**, not in code — official rows are curated at
    `/manage/library/categories` and lead the picker; ANY member may add one from the picker's
    新建分类 box. Creation is FIND-OR-CREATE (`lib/library/categories.ts`): typing a name that
    already exists in either language reuses it instead of forking the taxonomy, and a purely-CJK
    name gets a short hash slug (the slug is an identifier, never display text). `slug` is what
    `LibraryDoc.categories` stores, so renaming — or deleting — a category never rewrites
    documents; a deleted category just stops being offered. The 16 built-ins are SEEDED by
    migration `20260826130000_user_tags_library_categories` with their original slugs, so
    `labels.libCategory.*` still renders them; member categories have no message key and render
    their stored name. **The AI may only file a doc under OFFICIAL categories** — `overviewPrompt`
    takes the live official list and `parseOverview` validates against it.
  - **用户卡片 + 用户标签** (`components/user/UserHoverCard.tsx`, `lib/user-tags.ts`): wrap any name
    or avatar in `<UserHoverCard handle=…>` and it gains a hover card (banner, avatar, role badge,
    部门/研究所, 签名 = `User.bio`, tags, counts). One fetch per user per page via a module-level
    cache, fired on 150 ms hover INTENT so sweeping a list of forty annotators is not forty
    requests. Tags are two kinds in one table: `manual` (granted at `/manage/user-tags`, singly or
    by pasting a 工号 list) and `auto` (reconciled from what the member IS — today 版主 of a 专区 —
    and never grantable by hand). Either kind is HIDEABLE by the member at 设置 → 我的标签: the
    assignment stays, the card just stops showing it. The auto reconciler is best-effort and
    wrapped in try/catch — the 专区 tables are a separate evolving feature and must never be able
    to take down a user card. `toPublicAuthor`/`PublicAuthor` are deliberately untouched; the card
    is its own endpoint (`/api/users/[handle]/card`) with the same 隐私账号 trimming.
  - **Deleting a chapter** (`removeChapter`, DELETE on the chapters route) is the escape hatch for
    an extraction that swallowed an ad block. `chapterIndex` is DENSE and uniquely indexed per doc,
    so renumbering walks the later chapters ONE AT A TIME (a bulk `decrement` collides with the row
    it is about to overwrite) and carries chunks + highlights along, inside one transaction. The
    last chapter cannot be deleted, and chunk-derived stats are only rewritten when chunks remain.
  - **共享批注 is a first-class surface** (`AnnotationsTab.tsx`, its own 批注 tab; migration
    `20260825120000_library_annotation_social`). One list of every annotation whose owner turned on
    公开我的笔记, with the three controls a discussion list needs: WHO (multi-select annotator rail —
    empty selection means everyone), WHAT (free-text index over quote + note + author name) and
    ORDER (原文顺序 / 最新 / 最热). **Sort and search run in SQL** (`getSharedNotes` filters) so they
    stay correct under the 500-row cap; the annotator selection is CLIENT-side so toggling is
    instant — and it feeds the in-text markers too (`filterByAnnotators(othersOnly(notes), …)`), so
    the page and the list always show the same people. 最热 ranks `likeCount` then `replyCount`;
    `LibraryNoteLike` + the denormalized `LibraryHighlight.likeCount` move together in ONE
    transaction with guarded writes and the route answers from an authoritative re-read (the
    like-route pattern). Comments follow the site-wide **2-level flat contract**: `parentId` is the
    thread ROOT, replying to a child re-roots to that child's parent so a third level can never
    appear, and the transient `replyToId` only routes the notification. 专家 badges are the EXISTING
    role system — the notes API surfaces `authorRole` for any role that is not `member`, so a
    deployment creates 专家 in 管理后台 → 角色与权限 and assigns it; `toPublicAuthor`/`PublicAuthor`
    are deliberately NOT extended (the badge rides on the annotation payload, not the identity
    contract). 我的笔记 keeps only the PERSONAL workspace (own highlights incl. unshared, composer,
    settings) — the community half lives in 批注 and must not be duplicated back.
  - **Selection actions are a floating toolbar again** (`SelectionToolbar.tsx`): 高亮 / 笔记 / 翻译 /
    问 AI / 复制, all CLICKABLE — the `1`–`4` / `N` keys are a shortcut, never the only way in. It
    was deleted once after being blamed for unselectable text; the real cause was the
    `dangerouslySetInnerHTML` identity bug above. The rules that keep it safe: the CONTAINER never
    `preventDefault`s mousedown (only the buttons do, so it is not a black hole that eats the next
    drag), ANY outside mousedown dismisses it, and it is positioned from `anchoring.textRects`
    (never `Range.getClientRects`, which also returns block border boxes), flipping below the
    selection when there is no room above. `MarginNotes` gutter stacks still hide themselves when
    the gutter is under 56px so nothing else overlays the column.
  - **Reader marks are painted BY THE BROWSER** (`components/library/reader/highlighter.ts`,
    CSS Custom Highlight API + `::highlight()` rules in `read/reader.css`, keyed on the `--hl-*`
    tokens so 浅色/护眼/深色 come free). Nothing is injected into the article and NO rectangles are
    positioned, which is the whole point: the Ranges are LIVE, so marks follow reflow with zero
    recompute, and painting can never disturb a selection. Do NOT go back to overlay boxes —
    `Range.getClientRects()` also returns the border box of every fully contained block, which is
    what painted highlights over margins/blank space and made empty space clickable. Anything
    needing geometry (the no-`CSS.highlights` fallback boxes, MarginNotes' gutter, hit-testing)
    goes through `anchoring.textRects`/`textBounds`, never `getClientRects` on the composite range.
    Clicks hit-test with `caretPositionFromPoint` + `isPointInRange` (exact, not rect containment);
    a click on an own mark opens `MarkPopover` (palette + the annotation, editable in place +
    delete), on a shared one `CommunityNotePopover`.
  - **Anchoring** (`anchoring.ts`): offsets primary, quote fallback. `locateMark` only trusts the
    offset range when its text STARTS with the stored quote — that check is load-bearing (it used
    to end in `|| got.length >= want.length`, which is true for every highlight, so shifted content
    painted the wrong sentence forever). Quote matching strips ALL whitespace (DOM text nodes abut
    across blocks). The TreeWalker pass is memoized per root in a self-invalidating WeakMap.
    `getTextOffsetOfPoint` returns **null** on a rejected point — never 0, which used to anchor at
    the top of the chapter. A selection is resolved from its START container (then END), so
    cross-chapter (连续滚动) and header-touching selections anchor to the chapter they start in
    instead of being silently dropped. A debounced MutationObserver re-anchors after anything
    rewrites the text nodes (chiefly Chrome/Edge in-page translation, which collapses every Range).
  - **Bilingual stored content** (migration `20260813120000_library_bilingual_content`):
    `aiOverview`/`aiOverviewEn`, `summary`/`summaryEn`, `abstractMd`/`abstractMdEn`,
    `LibraryChapter.aiSummary`/`aiSummaryEn`. 中文 is the source of truth AND the fallback;
    `lib/library/i18n-content.ts` (`pickText`/`pickOverview`) resolves per viewer locale at the
    SERVER boundary (fr reads the English twin). The indexer generates 中文 first, then translates
    the finished 导读 in ONE call and the chapter summaries in batches — best-effort, so a failed
    translation never fails the index run. `force: true` (重新索引) is what backfills existing docs.
    **Never translate `aiKeywords`** — retrieval matches them literally against source text — and
    retrieval always reads the 中文 `aiSummary`; `aiSummaryEn` is display-only. `abstractMd*` is
    human-authored: the uploader fills both languages in the 中文/English tab, AI never touches it.
  - **Chapter editing** (`/library/<slug>/edit` → 编辑): `LibraryChapter.html` is an HTML field, so
    it is edited as HTML — `components/library/ChapterHtmlEditor.tsx` is a contenteditable surface
    wearing the reader's own `.reader-prose` (排版 mode, the default) with a 源码 textarea escape
    hatch. Do NOT route it through `RichTextEditor`: that is the markdown-native editor for `*Md`
    fields and its markdown-it + ProseMirror round trip drops table/colspan, figure/figcaption,
    sup/sub, span, mark — exactly the tags `sanitizeChapterHtml` deliberately keeps. The sanitizer
    pre-normalizes generic containers (`div`/`section`/…) into `<p>` BEFORE DOMPurify, because
    DOMPurify unwraps them and `<div>a</div><div>b</div>` would otherwise collapse into "ab",
    destroying `htmlToPlainText`'s paragraph boundaries and every offset derived from them.
    Editing a chapter does NOT remap existing highlights — the quote fallback re-anchors them.
