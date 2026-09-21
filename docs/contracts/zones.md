# 技术专区 (Tech Zones) 与组织架构

> 从 CLAUDE.md 拆出。v1 → v5 全部契约。

- **技术专区 (Tech Zones, migration `20260826000000_add_tech_zones`)**: team boards at `/zones`
  (`Zone`/`ZoneRole`/`ZoneMember`/`ZonePost`/`ZonePostAuthor`/`ZonePostAttachment`/`ZonePostLike`/
  `ZonePostBookmark`/`ZonePostComment`/`ZonePostCommentLike`/`ZonePostView`/`ZoneWikiPage`/
  `ZoneWikiRevision`/`ZoneLinkPreview`). **Login-walled by layout** (media is served by
  `/api/zones/media/[...key]` with `auth()` + Range). Contract modules: `lib/zones/permissions.ts`
  (import-free zone-level catalog `manage roles members post moderate wiki comment` +
  `buildZoneAccess` — the ONLY policy function; every surface consumes the pre-decided
  `ZoneAccess` booleans, never re-derives), `lib/zones/shared.ts` (slugs, limits, embed-token
  contract, cursors, `excerptOf`, `extractHeadings`), `lib/zones/types.ts` (every view type crossing
  the RSC/API → client boundary). **Roles**: 主版主 = `Zone.ownerId` (implicit `*`, only 转让 or a
  site admin changes it); each zone seeds `moderator`/`author`/`member` system roles on create
  (`ZONE_SYSTEM_ROLES`) and may add custom roles; `ZoneMember.roleId null ⇒ member role`;
  a members-manager cannot hand out a role carrying `roles` (`canAssignZoneRole`). Site permission
  `zones` = siteAdmin: bypasses visibility and every zone check (logAdmin on those actions);
  creating a zone needs `can(user,'zones') || User.canCreateZones` (toggle at /manage/users/[id]).
  Visibility `public` (any logged-in user) / `members`; join policy `open|approval|invite`
  (pending rows = join requests → `zone_request` notification to owner + members-managers;
  decisions → `zone_member`). Posts: types article/report/paper/slides/link/announcement
  (`announcement` needs `moderate`), co-authors must be active members, attachments echo
  upload keys re-validated (shape + on-disk + `@unique key` backstop) and are replaced wholesale on
  edit (unreferenced files + preview files unlinked); office files get a best-effort LibreOffice→PDF
  `preview/` rendition (`lib/zones/office-preview.ts`: `SOFFICE_BIN` → PATH → mac app path; in-process
  FIFO; `unsupported`/`failed` never throw) with a per-slide HTML fallback via
  `lib/library/extract-office`. Comments = the site-wide 2-level flat contract (copy of discussion);
  likes/bookmarks/views = guarded tx + authoritative re-read. **Native embeds**: own-line
  `[embed:<kind>:<ref>]` tokens (kinds `library short video skill pack event post file link`;
  fence-aware splitter mirrors polls-shared) resolved SERVER-side in one pass by
  `lib/zones/embeds.ts` — every kind goes through its SOURCE domain's own gate (`canReadDoc`,
  `canViewVideo`, `DISCOVERABLE_SKILL_WHERE`, pack `isPublished`, event `deletedAt`, zone access for
  post/file) — and rendered by `components/zones/ZoneMarkdown.tsx` → `EmbedCard` → the right-side
  `PreviewDrawer` (`components/zones/preview/*`, hosted by `PreviewProvider` in `app/zones/layout.tsx`;
  library chapters render inside `.reader-root/.reader-prose` with the MEMOIZED innerHTML object).
  `link` refs are OG-scraped through `fetchPage` (SSRF-guarded) into `ZoneLinkPreview`. The editor
  gets the picker via `RichTextEditor`'s optional `embedPicker` prop (`contentEmbed` atom node,
  inserted at the top level like polls). Wiki: page tree per zone (slug unique per zone,
  auto `page-<id>` for CJK titles), a `ZoneWikiRevision` snapshot on every save, restore = new
  revision. **Motion kit** `components/motion/*` (SpotlightCard/BlurText/CountUp/Magnetic/
  StaggerGrid+LiveList/GlareHover/TiltCard/TabBar/Stepper/HairlineGrid/DrawerShell/RollingNumber):
  monochrome, SSR-visible (hidden start lives in `whileInView` keyframes, never `initial` on
  server content), reduced-motion + fine-pointer gated. **Trap that tsc cannot catch**: a helper
  exported from a `'use client'` module is only a client REFERENCE when an RSC page imports it —
  calling it there throws "is not a function" at runtime (this bit `settingsTabsFor`; keep such
  helpers in plain modules like `app/zones/_components/settings-tabs.ts`).
  **v2 (migration `20260826120000_zone_columns_post_visibility`)**: 栏目 (`ZoneColumn`, service in
  `lib/zones/columns.ts`) is the per-zone content taxonomy, ORTHOGONAL to `ZonePostType` (which is the
  content FORMAT) — 版主 curates `official` rows in 版块设置, members create their own from the composer
  when `Zone.allowMemberColumns`; `getOrCreateColumn` dedupes on `columnDedupeKey` BEFORE creating and
  keeps the slug stable across renames (`?column=<slug>` links are shared). **Per-post visibility**
  `ZonePost.visibility zone|members|restricted` NARROWS within the zone and never widens it: the pure
  decision lives in the import-free `lib/zones/post-access.ts` (`decideZonePostAccess`) and its SQL twin
  `zonePostVisibilityWhere` — lists must EXCLUDE in SQL, never fetch-then-filter (paging counts break),
  and the pair must stay in agreement. `restricted` grants are `ZonePostViewer` rows (`designated` or
  `code`); the share code is a capability token (like a 提取码, `timingSafeEqual`-compared, rotating it
  evicts everyone who used the old one), shipped ONLY to author/co-authors/moderators, and redeeming it
  still requires `access.canRead` — a grant never opens a zone you cannot read. `/zones` is a
  **feed-first landing** (`listZoneFeed` across zones: 最新/最热, multi-select 研究所→部门 via
  `zoneOrgTree`, 栏目/类型 facets, search) with 动态 / 版块 / 我的版块 tabs; the 版块 tab groups by 研究所.
  Zone chrome rules: the 管理 and 加入 dropdowns MUST portal out of the header (it is
  `relative overflow-hidden`) — both ride `useAnchoredPanel` (now `components/useAnchoredPanel.ts`,
  shared with the navbar's overflow menu); 研究所·部门 gets its own prominent
  untruncated row (never the capped `DeptTag`); and zone titles are PLAIN TEXT (no BlurText).
  **Editing**: a post is editable by its 主作者, any 合著者 (`ZonePostAuthor` — they hold the same
  content rights) and any `moderate` holder; `updateZonePost` stamps `editedAt` + `editedById` on a
  CONTENT change to a PUBLISHED post only (drafts are still being written), and the header renders
  「最后由 X 编辑于 …」 so a 版主 editing someone else's post is visible rather than silent.
  **Relative times go through `app/zones/_components/RelTime.tsx`** — a text-only `<time>` carrying
  `suppressHydrationWarning`, because the string ticks over between SSR and hydration; the attribute
  does NOT cover a text node sitting beside a sibling icon, which is what caused the hydration error
  the first time. When the time is interpolated into a translated sentence, wrap that sentence in its
  own text-only element with the attribute (see `PostHeader.tsx`). **`Zone.slug` is
  IMMUTABLE** after creation (notification links / bookmarks embed it): the PATCH route strips it
  and `updateZone` throws `slug_immutable` as the lib-level backstop. Post publish is re-gated on
  the draft→published TRANSITION (`canPost`, `canModerate` for announcements) — being the author is
  not enough, since permissions can be revoked after the draft was written. i18n namespace `zones`
  (+ `labels.zonePostType/zoneVisibility/zoneJoinPolicy/zoneRole`, `api_errors.zone_*`); merge
  fragments with `scripts/zones-i18n-merge.mjs` (also `--check` for parity). Admin `/manage/zones`
  (精选/转让/软删除/恢复/新建); search bucket `zones`; docs `/docs/zones`.
  **v3 (2026-09-01, NO migration) — 类型隐藏、栏目即分类、版主可见、并排阅读、正文内上传.**
  - **帖子类型是隐藏的，不是删除的.** The `ZonePostType` column stays; zod `type` defaults `article`, PATCH keeps
    the existing value, `link_required` is gone (linkUrl is always optional), and NO surface renders a type pill.
    The one surviving value is `announcement` = a 版主 FLAG set from the post's ⋯ menu (`PATCH {type}` under
    `canModerate`) that renders the 版主公告 band at the top of the zone home (`ZoneNotice`: newest published
    announcement on the unfiltered stream, removed from the list below, dismissed per zone through the
    `aic.zone-notice` cookie scoped to `<basePath>/` — `lib/zones/notice-cookie.ts`). Do not resurrect a type
    picker or a 类型 filter; `labels.zonePostType.*` stays only for that pill.
  - **栏目 IS the taxonomy.** Zone home = left `ColumnRail` (xl; chip row below) + `ColumnBand` for `?column=<slug>`
    (description, ✕); `?column=_none` (`UNCATEGORIZED_COLUMN_PARAM` — `_` can never be a slug) = 未归栏
    (`columnId IS NULL` branch in `listZonePosts`); 版块设置 → 栏目 (`ColumnsEditor`, gate `canModerate` like the
    column routes: create / rename / describe / reorder by drag + ↑↓ / 官方 toggle / delete-with-move /
    允许成员自建); the composer's first control is the inline `ColumnPicker` and it stays OPTIONAL on publish.
  - **版主 presence is rendered, never implied.** `lib/zones/lead-roles.ts` (`buildLeadRoles(ownerHandle,
    moderatorHandles)` from a DEDICATED `listZoneMembers({ roleKey: 'moderator' })` query — never derived from the
    12-avatar wall) → `app/zones/_components/RolePill.tsx`, the ONLY way a lead role reaches a byline (rows, post
    header, comments, notice, moderators card). Handles only — department / lab / email never enter it. Zone home:
    compact header (`LeadsStack` + policy sentence, no metrics row), `PinnedBand`, fixed-order right rail
    (关于 → 本周动态 `zoneActivityPulse` omitted at zero → 版规 = wiki page `rules` (`lib/zones/rules.ts`; `deleteWikiPage`
    releases the slug as `<slug>~del-<id>` so `rules` can be recreated) → 成员 → 版主 + 联系版主 → 外链),
    `OnboardingChecklist` for managers of an empty zone; members grouped by role with management behind ⋯ +
    paging. Hub: no 类型 facet; feed rows carry `zone.iconUrl` (public metadata on `ZonePostCardView.zone`).
  - **并排阅读面板 (`components/motion/DockShell.tsx` + `components/zones/preview/*`).** `PreviewProvider
    mode="dock"` (zones layout; 讨论区 keeps `modal` = the untouched `DrawerShell`) renders an in-flow `sticky h-dvh`
    aside: NO scrim, NO body scroll lock, NO aria-modal — parallel reading is the point, never add a scrim "for
    consistency". The navbar is HELD VISIBLE while docked (`holdNavBarVisible()` in `lib/nav-chrome.ts`;
    precedence `hidden = heldHidden || (autoHidden && !heldVisible)`; `NavBarShell` also publishes `--nav-offset`
    68px/0px on `<html>`) and the aside starts at `marginTop: -68` so it spans the viewport. Sash =
    `useSplitResize` (pointer capture, rAF/MotionValue writes — no React state per move, a transient
    `fixed inset-0` shield; NEVER `pointer-events:none` on the iframe — Chrome then breaks wheel scrolling — the
    iframe goes `visibility:hidden` during the drag instead), bounds in `split-shared.ts` (380 / 520 default /
    `min(760, vw − 640)`, rubber-band ≤ 40 px then `SPRING_DRAWER` snap-back, persisted `zones:dock:w`, width only —
    never "open"), keyboard ←/→ (Shift ×4) / Home / End / Enter, double-click reset. ⤢ expand = aside 100 % + page
    wrapper `inert=""` + navbar held hidden. ⛶ = `useFullscreen` on a STABLE wrapper inside `PreviewBody` (never the
    animated aside — unmounting exits fullscreen), `requestFullscreen` called synchronously in the click (an
    `await` first loses user activation), state ONLY from `fullscreenchange`, iPhone / blocked frame → the
    permanent `fixed inset-0 z-[96]` maximize fallback; anything portaled must target `usePortalHost()`
    (`fullscreenElement ?? body` — `Toaster` does, or toasts vanish under the top layer). Two-stage ESC:
    fullscreen → panel, and ignored while an `[aria-modal]` dialog is open or focus sits in an input /
    contenteditable outside the aside (the comment box keeps its ESC). `PreviewTarget` carries `data`
    (pre-resolved embed → no refetch), `siblings` (↑/↓ through a post's attachments) and `via`
    ('keyboard' moves focus to ✕ and back); `usePreview()` exposes `current` / `isDocked`; `usePageBand()`
    ('wide' ⇔ page column ≥ 1008 px, measured by a ResizeObserver) drives the post-page grid — NEVER `xl:`
    (the viewport does not shrink when the dock takes 520 px of it). A route change clears the stack, the
    width survives. Below lg / coarse pointer → the modal drawer, with ⛶ (maximize) in its header.
  - **正文内上传.** `[embed:file:<ref>]` accepts a ROW ID or a STORAGE KEY (`EMBED_FILE_KEY_RE`,
    `image|video|file/<nanoid>.<ext>` only); `resolveFile` answers by id OR key under the SAME `canSeeZonePost`
    gate (keys are already visible in every media URL, so the key form widens nothing). The editor
    (`RichTextEditor` `embedPicker.upload` — zones only; 讨论区 passes none and still ignores non-image drops)
    inserts a WIDGET-DECORATION placeholder (`components/zones/embeds/file-upload-plugin.ts`: the doc is unchanged
    while uploading, progress writes `--p`, a per-view sequential queue, 429 → wait `retry-after` ≤ 3 retries, then
    ONE undoable insert of `contentEmbed{kind:'file', ref:<key>}`), cards render local-first through `getLocal()`
    (ledger drafts keyed by id AND key — no `not_found` flash), the composer appends every upload to the ledger
    and the server unions `bodyFileKeys(bodyMd)` into the attachment set on create and on update-with-attachments
    (`mergeBodyFileKeys` — a body file is never an orphan; a bodyMd-only PATCH leaves rows alone); removing a
    ledger row strips its own-line token. Attachment COUNTS are unlimited by product decision (byte caps + the
    30/min limiter stay; hidden `MAX_ATTACHMENT_ROWS_PER_POST` 500 only bounds the disk-stat fan-out;
    `MAX_EMBEDS_PER_CONTENT` 200). **Tables round-trip now** (`@tiptap/extension-table*` registered; before this a
    markdown table was flattened to text the moment a post was re-opened in the editor).
  - **Composer is document-first**: `ComposerTopBar` holds the navbar hidden and sits in its slot via
    `marginTop: -68`; `RichTextEditor chrome="document" size="article"` (the reader's `ARTICLE_PROSE_CLASS`,
    `lib/zones/prose.ts`, 17 px / 1.75 — writing measure = reading measure); non-text settings in
    `ComposerSettingsSheet` (sticky column on xl, drawer below); `DRAFT_VERSION` 3 strips `type` from stored
    drafts; the embed AND poll normalizers dispatch their initial transaction with `preventUpdate`, else a pristine
    post is "dirty" on open (autosave + a 恢复 banner nobody asked for). Reading page: `MarkdownRenderer
    size="article"`, `PostRail` (240 px rail ↔ 40 px strip whose hover/tap opens an OVERLAY — never a width tween
    while someone is mid-sentence), `ReadProgress` hairline (the old scroll-up `PostContextStrip` was DELETED in
    1951333 — do not target it), `useLikeBookmark` shared by the action bar, `BodyImageLightbox` (ONE delegated click on
    `ZoneMarkdown`; stickers by RAW src prefix, linked images and embed thumbnails are skipped).
  - **Motion grammar** = `lib/motion.ts` `TWEEN_FAST` / `TWEEN` / `TWEEN_PANE` (+ the used-for / never-for table
    there); the whole budget is the M1–M27 table in the redesign spec — titles, prose, avatars, first-paint
    counts, route changes, menus, typing and page appends never animate. `DockShell` and `DrawerShell` are
    deliberately two components (non-modal vs modal). i18n prefixes added this round: `panel_*`, `columns_*`,
    `home_*`, `column_rail_*`, `column_band_*`, `notice_*`, `rules_*`, `mods_*`, `onboard_*`, `composer_*`
    (new), `attach_*` (new), `post_*` (new), `rail_strip_*`, `strip_aria`, `ui.rte_table_*`, `ui.rte_upload_file`.
- **组织架构 = `lib/org.ts` 的词汇 + 版块自己填的数据 (2026-09-11)**: 研究所 (top) → 实验室 → 版块.
  写死的六个研究所**已删除**（owner decision：「目前还没有这么多，让版主自己创建板块，再选择隶属于
  哪个 lab 和哪个研究所」）——`INSTITUTES` 现在是**空数组**，组织树完全由 `Zone` 行汇总而来（导航栏
  磁贴 `zoneLabCards()`、`/zones` 研究所侧栏、`zoneFacets` 建议列表都只列**至少有一个版块**的
  研究所）。建版块/版块设置里的 研究所·实验室 在目录为空时是两个 **datalist 组合框**（`OrgFields`；**v5 把目录搬进了数据库**，目录非空时变成下拉选择 —— 见「技术专区 v5」）：建议来自
  已有版块 ∪ 员工名单，选同一拼写就归到一起，直接输入新名字也永远允许。合并/占位/排序的机制
  （`mergeInstitutes`/`labsOf`/`withConfiguredInstitutes`）保留且配置为空——将来要钉顺序或配封面，
  加一条 `INSTITUTES` 记录即可；这些规则只在测试里对着 fixture 跑（`tests/fixtures/org-fixture.ts`，
  三个 org 测试用 `vi.mock('@/lib/org', …createOrg(ORG_FIXTURE))`）。
  **The `Zone` columns are named backwards and are deliberately NOT renamed**: `Zone.lab` holds the
  研究所 and `Zone.department` holds the 实验室 (the columns predate the org model; renaming them
  would rewrite every query, index and payload for a naming nit). Read them through the helpers,
  never assume the column name means what it says. Live 版块 whose 实验室 is not in the config are
  NOT dropped: `withConfiguredInstitutes` (lib/zones/shared.ts) is the ONE canonical merge —
  configured first in config order, live extras after, busiest first. Don't add a second merge.
  Covers in `public/labs/` are only used when an `INSTITUTES` entry names them; a missing file
  falls back to a name-hashed identity colour, never a broken image.
- **技术专区 v4 (2026-09-11, migration `20260911000000_zone_theme_color`) — 贴吧式主页与版块头部.**
  User's ask: 「目前看起来很混乱，也不吸引人，也没有很多可以自定义的内容……更符合贴吧、版主这类，
  给各 lab 实验室来创建自己的板块」. Functions untouched; what changed:
  - **`Zone.themeColor`** (`#rrggbb` | null, `normalizeThemeColor`/`isValidThemeColor` in
    lib/zones/shared.ts) is the ONE new customisation. `zoneHue(name, themeColor)` (zone-color.ts)
    prefers it and falls back to the name hash, so every surface that painted a zone's colour
    (monogram, banner wash `zoneBannerStyle`, icon ring, wall tile, feed row icon) reads it through
    that helper — never `identityColor(name)` directly for a zone. Picker = `ThemeColorPicker`
    (12 identity swatches + native colour input + 恢复默认), in 版块设置 → 基本信息 and wizard step 1.
    It colours the zone's MATERIAL only (配色契约): buttons/tabs/pills stay ink.
  - **Hub (`/zones`)**: `ZoneHubHero` (eyebrow · h1 · big pill search `HubSearchBox size="lg"` ·
    three static figures from `zoneHubTotals()` · 创建 CTA · **`ZoneWall3D`** at lg+) →
    `MyZonesStrip` (viewer's boards as icon chips, 贴吧「我关注的吧」) → the same three tabs.
    动态 gets a third xl column, `HubSideRail` (热门版块 ranked + 开一个版块 card). `ZoneWall3D` is
    the one deliberately 3D thing: a `preserve-3d` grid under 1400px perspective at a resting
    isometric pose, pointer-nudged ±5° through springs (fine pointer + motion-safe only), tiles at
    three `translateZ` depths breathing on `animate-zone-float` (globals.css) — every tile is a real
    link, the float class is unconditional (`motion-safe:` gates it; a `reduce ?` className would
    not hydrate), columns = 2/3/4 by board count. No WebGL, no new dependency.
  - **Zone home**: `ZoneHeader` is a tall banner (cover, or theme wash + hairline grid + rotated
    watermark monogram — the banner div is `overflow-hidden` so the glyph never bleeds under the
    buttons), icon on a white plinth ringed in the theme colour, 成员/帖子/Wiki figures row, same
    tabs. `ZoneCard` got the same banner/watermark/ring treatment. The dashed 「设为公告」 how-to
    box moved out of the stream into the rail's 版主 card (`ModeratorsCard canModerate`);
    `ZoneNotice` renders nothing without an announcement.
- **技术专区 v5 (2026-09-11, migration `20260911150000_zone_site_catalog`) — 目录进数据库、首页文案进后台、版块自定义布局.**
  User's ask: 「侧边的研究所分类，以及栏目……在管理员界面里可以添加修改和删除，而不是写死在代码里」「技术专区的这些描述
  ……管理员最好也可以直接在管理平台里修改」「我的板块那里重复了，只留 动态/板块/我的板块」「给各技术专区更自由的设定、更产品化」.
  - **组织架构目录 = `OrgInstitute` / `OrgLab` 表**，维护在 管理后台 → 技术专区 → 组织架构 (`/manage/zones/org`,
    `lib/zones/org-admin.ts`, API `/api/admin/zones/org/*`). `Zone.lab` / `Zone.department` **仍然存名字**（无外键）：目录是
    STRUCTURE（顺序、存在、简介、封面），行只是填进去 —— 所以 **改名会在同一事务里改写所有版块的对应值**（名字就是 join key），
    删除只撤目录项，版块保留原值并作为 live extra 继续可筛（`lib/org.ts#mergeInstitutes` 的老规则）。`lib/org.ts` 的
    `INSTITUTES` 永远为空，只剩纯函数 `createOrg()`；服务端一律 `getOrg()` / `getOrgCatalog()` (`lib/zones/org-catalog.ts`,
    60 s memo，每次后台写都 `invalidateOrgCatalog()` + `invalidateZoneLabCards()`) 并把 `OrgApi` **当参数传给纯函数**
    (`withConfiguredInstitutes(tree, org)`, `buildZoneOrgTree(rows, org)`, `buildZoneOrgOptions(…, org)`)。测试 mock
    `@/lib/org` 时必须同时覆盖 `defaultOrg`（它是这些参数的默认值）。建版块/版块设置的 研究所·实验室 在目录非空时是两个
    **`<select>`**（研究所 → 该所实验室），末尾「其他（手动输入）」才展开自填框；库里存了目录外的值会以「其他」态打开且值不丢。
    迁移把现有版块在用的 研究所/实验室 回填进目录，所以管理员打开就是真实数据；`db push` 部署要手动跑那两条 INSERT。
  - **栏目预设 = `ZoneColumnPreset`** (`/manage/zones/columns`, `lib/zones/column-presets*.ts`)：站级标准栏目。三处消费：
    `createZone` 事务里播种为 official `ZoneColumn`；「同步到所有版块」只**补缺**（按 `columnDedupeKey` 去重，永不改名/删除
    版块自己的栏目 —— 预设是底线不是上限，满 `MAX_ZONE_COLUMNS` 的版块跳过并计数）；专区首页左侧 栏目 facet 按预设顺序排前
    （0 帖也显示，`orderColumnFacet`）。版主在版块设置里的 栏目 tab 不变。
  - **首页文案与模块开关 = `ZoneSiteSetting` 单行** (`/manage/zones/settings`, `lib/zones/site-settings*.ts`)：`copy` 按语言存
    {eyebrow,title,subtitle,createTitle,createDesc}，解析链是 **本语言 → 中文 → i18n 默认** (`resolveZoneHubCopy`，中文是 stored
    content 的 source of truth，与知识库双语字段同一家法)，后台输入框的占位符就是当前语言的 i18n 默认值，留空即默认。四个开关
    `showWall/showTotals/showHotRail/showFeatured` 在 `ZoneHubHero` / `page.tsx` 生效（关掉版块墙时左栏收成单列 `max-w-3xl`）。
    `hubCopy()` (ZoneHubHero.tsx) 是页面、hero、右栏三处共用的唯一入口。30 s memo。
  - **`MyZonesStrip` 已删除**（与「我的版块」tab 重复）；i18n 里 `hub_mine_strip_*` 一并删掉。
  - **版块自定义**：`Zone.topics String[]`（≤6 个、每个 ≤16 字，`sanitizeZoneTopics`；头部与卡片渲染成 `PILL_TOPIC` 墨色描边
    chip，点击去 `/zones?q=`；hub 搜索目前**不**匹配 topics —— Prisma `String[]` 无 substring 操作，需要时在 `listZones` 加
    `hasSome` 或改 `matchesQuery`）和 **`Zone.sidebar Json` = 主页布局** (`lib/zones/sidebar.ts` 纯契约)：`{order, hidden,
    custom[{id,title,bodyMd}]}`，六个内置模块 `about pulse rules members moderators links` 可排序/隐藏（`about` 不可隐藏），
    自定义卡片 ≤6、标题 ≤40、正文 ≤4000 markdown，id 形如 `custom:<8 位 a-z0-9>`。`parseSidebarLayout` 是唯一 sanitizer，
    **缺失的内置模块会被追加回来**（以后新增模块不会在已自定义的版块上消失），`ZoneSidebar` 只按 `visibleSidebarModules()`
    走一遍、内置模块 markup 原样保留，自定义卡片走 `ZoneMarkdown compact`；我的草稿卡固定在布局之外最后。编辑器 =
    版块设置 → **主页布局** tab（`SidebarLayoutEditor`，gate `canManage`，`settings-tabs.ts` 顺序 basic/access/columns/
    layout/roles/danger —— `tests/zones-columns.test.ts` 钉着这个顺序），PATCH `/api/zones/[slug]` 的 `sidebar` 超限回 400
    而不是静默截断。
  - Manage 页全部中文；三个新页已登记 `PAGE_NAMES`。i18n 新 key：`create_org_pick_*`/`create_org_catalog_hint`、`layout_*`、
    `topics_*`、`settings_tab_layout`。

- **帖子封面版式 + 裁切 (2026-09-18, migration `20260918000000_video_subtitles_covers`)**: `ZonePost.coverAspect`
  (`landscape|portrait`) + 三态 `coverPos` (`''` 居中裁切 / `'contain'` 完整显示 / `'x% y%'` 取景) — the shared cover
  contract `lib/media/cover-pos.ts` (same vocabulary as `VoteEntry.posterPos`, `Video.posterPos`; full rules in
  video.md), rendered ONLY through `components/media/CoverImage`.
  - Zone-side rules live in the pure `lib/zones/post-cover.ts`, and zod in `post-cover-schema.ts`, NOT in
    post-queries — route tests mock that module with a fixed export list. A locked stub ships the defaults
    along with `coverUrl: null`. Removing the cover resets both columns. **A different image never inherits the
    old crop.** A patch that does not mention framing leaves it alone. Junk is a 400, never "fixed" (`coverPos`
    reaches a style attribute).
  - Framing is PRESENTATION: it is outside `contentChanged`, so re-cropping a published post never stamps
    「最后由 X 编辑于」.
  - Surfaces: `PostRow` thumb is `slot="adaptive"` (portrait = a 3:4 thumb of the SAME height, so rows never
    grow). `PostHeader` keeps 2:1 for 横版, and 竖版 stands on a 16:10 blurred wall (`slot="landscape"`).
    `PinnedBand`'s 56 px square only honours the focal point.
  - Composer: a picked image is measured with an `<img>` (follows EXIF orientation) and starts from
    `defaultCoverFor` — a tall 海报 = 竖版 + 完整显示. 调整封面 = `CoverAdjustDialog`, a thin wrapper over the shared
    `components/media/CoverCropDialog` with `postCoverRatio` (2:1 / 3:4). `DraftState` gained the two fields
    APPENDED and default-filled WITHOUT a `DRAFT_VERSION` bump, so an older build can still read a newer draft.

