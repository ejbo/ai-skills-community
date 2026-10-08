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
  - **译文 / 阅读语言 (2026-10-07, migration `20261007120000_library_multilang_translation`)**. Owner:
    「读者可选 中文 / English / 原文；中文界面默认中文、英文界面默认英文，阅读器里可调；标题也跟着语言走；
    正文自动翻译（分块交给 AI）」. The model:
    - **Targets** (`lib/library/translation-shared.ts`, import-free): a doc is readable in 原文 plus every
      content language that is not its own — `targetLangsFor`: 中文 doc → en, English doc → zh, anything else
      (`language` null) → both. Only zh/en are translated INTO (fr UI reads English, like the stored twins).
    - **Default + choice**: reader pref `textLang` (`reader-prefs.ts`, localStorage) = `auto | original | zh | en`;
      `resolveReaderText` turns it into what to show (`auto` = UI language; a doc already in that language shows
      原文). The chrome 文A button (`LanguageMenu.tsx`) sets the REMEMBERED pref via `prefForChoice` (picking what
      `auto` would pick stores `auto`); the in-article notice's 显示原文 and any jump to a highlight / note /
      citation are a THIS-PAGE override to 原文 (`textOverride`) — marks anchor to original offsets, so a jump
      first switches to 原文 (`ensureOriginal`), then runs once the original is committed and repainted.
    - **Storage**: ONE shared passage cache `LibraryTranslation(docId, targetLang, sourceHash)` (unchanged, keyed by
      the whitespace-normalized source — selection translate and the passes share rows, a passage is paid for
      once). Rebuilt chapters live in `LibraryChapterTranslation(chapterId, targetLang, html, title, sourceHash)`
      — `sourceHash` = sha256 of the chapter html it was built from, so an edited chapter reads as untranslated
      instead of showing a stale page (`isFreshChapterTranslation`; rows migrated from the old one-direction
      scheme carry `'legacy'` and stay visible). The chapter edit route and `updateChapterContent` also DELETE the
      chapter's translations. Pass state per language = `LibraryDocTranslation(docId, targetLang, state, error,
      heartbeatAt, finishedAt)` — it is the LOCK too: claimed with `createMany skipDuplicates` / a guarded
      `updateMany`, heartbeat after every chapter, a `running` row silent for `STALE_LOCK_MS` (10 min) may be
      re-claimed (`effectivePassState` reports it as `none`). Never go back to "one translatedHtml per chapter".
    - **Titles**: `LibraryDoc.titleTranslations` = `{ source, zh?, en? }`, merged ATOMICALLY with `jsonb ||` and
      conditioned on the title still being `source` (two language passes finish together). Self-invalidating:
      `pickDocTitle(locale, doc)` / `translatedTitle` ignore it once `source !== title`. Cards, list rows, the
      detail page (with 原标题 underneath), embeds and the reader (chrome, h1 + 原标题, chapter titles, 目录) all
      read it. `DOC_CARD_SELECT` carries `language` + `titleTranslations` for this. Search still matches the
      ORIGINAL title only.
    - **When it runs** (`lib/library/translate-doc.ts`, `runDocTranslation(docId, lang, {force, startChapter})`):
      after indexing for every target (`runDocTranslations`) when the doc is under `LIBRARY_AUTO_TRANSLATE_MAX_CHARS`
      (40k); over it only the TITLE is translated at ingest. Opening the reader in a language with missing
      chapters/title starts the pass BY ITSELF (once per language per visit, POST `/api/library/docs/[id]/translate
      {lang, startChapter}` — the chapter on screen first, then wrap). The reader polls `GET …?lang=` every 4 s
      and `router.refresh()`es when the current/next chapter lands (≥ 8 s apart) and once at the end. A terminal
      state only counts when its `finishedAt` ≥ the POST's server `at` (a refresh can show the PREVIOUS run's end
      before this one claims its row), and a server refresh may never end a local `running` — only the poll may.
      Rate limit counts only passes that actually start (40/h/user). Failures never throw: a chapter with zero
      coverage gets no row (retried next pass), 3 consecutive all-failed chapters abort the pass, partial
      coverage keeps the original text for the missing blocks.
    - **Chunking** (`translation.ts`): ≤ 12 passages AND ≤ 4000 source chars per model call, 2 calls in flight,
      passages a reply dropped get one more try; only all-calls-failed throws. Leaf blocks are rebuilt with
      `textContent` (`applyBlockTranslations`) — model output is never parsed as markup; `<pre>/<code>` is never sent.
    - **Selection translate** (`/api/library/translate`) takes `target` (the reader's UI language) and flips it
      when the doc is already in it (`selectionTargetFor`). **译文 mode hides highlights and the selection
      toolbar** — marks anchor to the ORIGINAL character offsets (the menu hint says so).
  - **链接 = 标题** (`lib/library/slug.ts`, docs/contracts/slugs.md): slugs are title slugs (`大模型推理优化实践`,
    `attention-is-all-you-need`), never `doc-<nanoid>`. Ingest re-derives the slug from the EXTRACTED title before
    the creating request returns (`reslugFromTitle` — the provisional title was the URL path / filename), then it
    is frozen. `pnpm slugs:backfill` moves old hash slugs and records `SlugAlias(kind 'library_doc')`; the three
    `/library/[slug]` pages resolve aliases (`resolveDocSlugParam`) and 308 to the current slug only AFTER their
    read gate, and `[embed:library:<old slug>]` refs resolve through the alias too.
  - **浏览页 /library (2026-10-08 改版)**. Owner: 「首页杂乱无章，日后内容多了很难找；分类不合理；精选位置不对；要展示上传者
    与来源（公众号要注明）」. Shape follows what reading sites do at volume (Readwise / Pocket / Lobsters / 豆瓣 / Medium brief):
    - **One dominant list, facets narrow it.** 版块 rail on top (`LIBRARY_SECTIONS`, 7 fixed, code + `labels.libSection.*`),
      the chosen 版块's topics as a second chip row with counts, then a quiet toolbar: search · 类型 (`TypeFilter`, a dropdown
      — format is a facet, never the top-level nav) · 排序 · 列表/卡片 toggle. **List is the default** (`?layout=grid` opts
      in). The 16-item left sidebar and the 类型 tab bar are gone; do not bring either back.
    - **Two-level taxonomy = `LibraryCategory.section`** (migration `20261008100000_library_category_section`). Sections are
      few and fixed in code; topics stay admin-curated / member-extendable in the table, each filed under one section
      (`/manage/library/categories` has the select; unfiled = 其他, shown only when it has docs). A doc still tags TOPICS
      only — its section(s) follow from them (`getBrowseCounts` counts a doc once per section). `?section=` filters
      `categories hasSome <topics of section>`; `?cat=` a single topic (validated against the LIVE list — the old
      `isLibraryCategory` check silently ignored member-created topics). `CategoryPicker` groups options the same way.
    - **精选 is a RAIL, not a hero**: ≤5 titles in the right column (`getFeaturedDocs(5)`), 「查看全部精选」→ `?sort=featured`;
      under it 最多收藏 (top 5 by shelfCount, numbered, hidden when nobody shelved) and 继续阅读 (`getContinueReading`,
      unfinished = `percent < FINISHED_PERCENT`, logged-in only). Never a full-width card grid above the list again.
    - **Every row says who and where from**: eyebrow = `SourceLine` (`lib/library/source.ts#librarySourceKind`: 公众号 /
      知乎 / arXiv / GitHub / … as a label + the account/site name; plain web = host; uploaded file = format badge PDF /
      EPUB / PPT / Word) · 阅读时长 · 精选 · 时间; footer = `<Avatar handle>` + 「{上传者} 收录」 + ≤2 topic chips + ★评分 ·
      收藏 · 评论. `DOC_CARD_SELECT` carries `sourceUrl` for this. Rows/cards are whole-row click targets via the title
      link's `after:absolute after:inset-0` overlay; the uploader chip and topic links sit above it (`relative z-10`) —
      never an `<a>` inside an `<a>`. Relative times carry `suppressHydrationWarning` (second-granular text differs
      between SSR and hydration for a doc added seconds ago).
  - **详情页 layout (2026-10-08)**: counters (字数 / 阅读时长 / 浏览 / 收藏 / 评论 = `DocFigures`, server) live in the LEFT
    column under 编辑内容与信息; the two figures that are PEOPLE (在读 = shelfCount, 公开笔记) are `DocPeople` — bordered pill
    BUTTONS with a chevron at the right end of the provenance row (查看原文 · 收录者 · 收录于), roster popover on click; 评分
    sits directly under them. The AI `summary` paragraph is NOT shown on the detail page (it duplicated AI 导读 — cards
    still use it as the blurb). 发表于 rides on the source line. `AiDigest`: 大纲 / 要点 side by side on md+, model
    attribution top-right, 「AI 生成，可能有疏漏」 footer.
  - **公众号 boilerplate (`lib/library/boilerplate.ts`, `tests/library-boilerplate.test.ts`)**: `extractArticle` runs
    `stripBoilerplate` on the sanitized html before chapter splitting. Head rules (「点击上方蓝字关注」 lines, GIF/QR
    banners) apply only to `mp.weixin.qq.com`; tail TRIGGERS (往期推荐 / 推荐阅读 / 扫码关注 / 点个在看 / END / 商务合作 …)
    apply to every site but only inside the closing stretch (last 16 blocks AND last 40 % of text), only when a short line
    or heading matches, and only when what follows is lines / links / images (a 「相关阅读」 heading followed by real
    paragraphs is a section). Safety rails: never cut > 35 % of the text or below 200 chars. 重新处理 re-applies it to
    existing docs. WeChat's in-feed ads are client-injected and never in the HTML — this is about the head/tail chrome.
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
