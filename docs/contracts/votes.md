# 投票活动 (Media Votes, /votes)

> 从 CLAUDE.md 拆出。与编辑器内嵌的 [poll:] 组件是两回事（后者见 editor.md）。

- **投票活动 (Media Votes, migration `20260817000000_add_vote_activities`)**: standalone
  作品评选 at `/votes` — DISTINCT from the embedded `[poll:<id>]` widgets (`Poll*` model
  names are taken; these are `VoteActivity`/`VoteEntry`/`VoteBallot`). Creator drafts an
  activity (POST `/api/votes`), bulk-uploads image/video entries via the raw-body protocol
  (`/api/votes/[id]/upload`): **every upload immediately creates a VoteEntry row — that IS
  the resumable draft** (refresh loses nothing); client captures video posters
  (probeAndCapture), ffprobe corrects duration, faststart remux, video size uncapped by
  product decision. 文件名解析 (`lib/votes/shared.ts` `VoteNameRule`: prefix strip +
  delimiter-SET split — every char is a delimiter, '-' escaped for the char class —
  → 作品名/作者/工号, 工号 lowercased per the EmployeeDirectory contract) applies at upload
  and via `/api/votes/[id]/apply-rule`; hand-edited rows carry `titleEdited` and are never
  re-overwritten (the server sets it only on a REAL value change — a no-op blur must not
  flag). Ballots: 每人 N 票 total or per-Beijing-day (`VoteBallot.day` bucket, `''` for
  total); **budgetPeriod locks once anyone voted** (`budget_period_locked` — switching
  would re-bucket and orphan every ballot); per-entry cap; 撤票 works on HIDDEN entries
  too (hiding keeps votes but must never trap a voter's budget). All counters are
  RECOMPUTED from ballot rows inside a Serializable tx with jittered P2034 retries (every
  vote rewrites the same VoteActivity row — contention is real, don't drop the backoff).
  **Voting is 先选后提交 (2026-08-24)**: a card click only edits a LOCAL draft in
  `VoteGallery` (`Draft = Record<entryId, desiredCount>`, holding ONLY overrides that
  differ from `entry.myVotes`; persisted per tab in sessionStorage
  `votes:draft:<activity>:<viewer.id>:<dayKey>`), the sticky toolbar shows the
  draft-adjusted budget + 提交投票/放弃, and ONE `POST /api/votes/[id]/ballots`
  `{ changes: [{ entryId, count }] }` (count = DESIRED total on that entry, so a retried
  submit is idempotent; unlisted entries untouched) applies everything through
  `planBallotChanges` (lib/votes/shared.ts, pure + unit-tested; `stepDraftCount` is its
  client twin so a click is refused for exactly the reason the server would reject it)
  inside the same Serializable tx. Invariants the review pinned: the cap and the budget
  gate INCREASES only (a creator may lower votesPerUser/maxPerEntry after ballots exist —
  a voter over the new limit must still be able to 撤回); the body echoes the client's
  `day` bucket and the server 400s `budget_reset` on a mismatch (a tab kept open across
  Beijing midnight would otherwise turn "+1" into an absolute count on the fresh day —
  the client clears the draft and re-reads); writes are batched (deleteMany / createMany /
  updateMany-per-count + ONE recount `UPDATE … SUM()` statement) with `timeout: 20s`, so a
  1000-entry draft never hits Prisma's 5 s P2028; `reconcileDraft` re-validates the local
  draft against every fresh payload (poll / failed submit / reload) — sheds pending adds
  newest-first when over budget, never touches revokes — so the toolbar can never offer a
  submit that only fails; a submit bumps `epochRef` so an in-flight 30 s poll can't
  overwrite the post-submit state. There is NO per-vote endpoint any more — don't
  reintroduce one.
  **定时开投 + 时区 (2026-08-27)**: `startAt` 早就只挡投票不挡投稿，这一轮把它做成
  发起人真的能用的功能 —— `VoteActivity.timezone`（migration `20260827000000_vote_timezone`,
  nullable）记录发起人填 startAt/endAt 时用的 IANA 时区。**瞬时仍然存 UTC**；时区只
  决定「输入框里回填成几点」和「前台标成东部/西部时间几点」。选项是**固定集合**
  `VOTE_TIMEZONES`（只有 America/Toronto + America/Vancouver，团队所在地），入库永远
  是 IANA 名、展示走 i18n key（`voteTimezoneKey`），老数据 `null` 按 `voteTimezoneOf`
  回落到默认时区。换算复用 `lib/events/time.ts` 的 `zonedWallToUtc`/`toWallDate`
  （全站唯一一份 DST 感知实现，客户端安全）—— **不要**再用 `new Date('...T10:00')`：
  那是按浏览器时区解释的，加西排的场到多伦多就差三小时，这正是本次要修的。
  编辑器里时区与两个 datetime-local 是一组：**换时区保留钟面**（“我说的是下午 2 点
  温哥华时间”），瞬时在保存时才由 `wallToIso` 算出来。前台：未开始时作品照常浏览，
  投票按钮渲染成**置灰的「未开始」**（不是消失 —— 消失会让人以为这活动根本不能投），
  顶部横幅给绝对时间（活动自己的时区，`formatVoteInstant` 显式传 `timeZone` ⇒ 服务端
  /客户端同串，无需客户端叶子、无水合不一致）＋ `Countdown` 给观众自己的相对时间。
  开始/截止瞬时到点时会 `refresh()`，否则守着 10:00 开投的人得手动刷新 —— 这个
  watcher 必须是**自愈**的（`boundaryTick` 重排 + `visibilitychange`）：只排一发
  `setTimeout` 的话，客户端时钟快几秒 / 那一次 429 / 后台标签页被节流，服务端都会回
  `started:false`，依赖项没变 effect 不重跑，页面就永远卡在「未开始」。评审扫出来、
  已修的另外几条：`isVoteTimezone` 必须用 `hasOwnProperty` 而不是 `in`（
  `Object.fromEntries` 带原型链，`'toString'` 会被当成合法时区存进库）；
  `resolveWallToInstant` 处理**夏令时缺口**（春季跳变当天 02:30 不存在，裸转换会悄悄
  落回 01:30，还会让「开始 01:30／截止 02:30」折叠成同一瞬时、服务端误报
  `end_before_start`）；发布提示只能读**已落库**的 `startAt`，且 `publish()` 在排期未
  保存时先 PATCH 再发布（否则提示写着"到点才开投"、实际当场开投）；已有票之后把
  `startAt` 改到未来会连撤票一起关上（切时区保留钟面时会顺带触发），服务端按
  `budget_period_locked` 的样子加了 `start_locked` 守卫。注意 daily 预算桶
  （`voteDayKey`）**仍按北京时间**刷新，与这里的活动时区无关。 Perf contract for the gallery: `EntryCard` is memo'd and fed a
  `CardCtx` that only rebuilds on flag flips (`budgetLeft` boolean, never the remaining
  number), `mergeView` keeps entry identity across the 30s poll, cards carry `.cv-auto`
  (content-visibility), and the toolbar is OPAQUE — backdrop-blur over the image grid
  was the scroll jank. The toolbar is `sticky top-0`; a 1px sentinel above it flips
  `stuck` (dock styling) and a second observer with an 80px `rootMargin` band calls
  `holdNavBarHidden()` (`lib/nav-chrome.ts`, counted holds) as soon as the toolbar enters
  the strip the navbar would occupy, so the global `NavBarShell` never overlaps it in
  either scroll direction — the scroll-up reveal used to stack both bars over the works.
  Docked and resting toolbar keep the SAME inner width/height (`-mx-6 px-8` ≡ `-mx-2 px-4`,
  `border-t-transparent` not `border-t-0`) so docking never re-wraps the controls.
  Results visibility (realtime / after_end / creator_only) and 匿名评选
  (showAuthors=false ⇒ authors hidden until over, then auto-revealed) are trimmed
  SERVER-side in `lib/vote-queries.ts` — hub cards, detail payload, vote responses,
  winner thumbs and the CSV all gate; the gallery order is a seeded per-viewer shuffle
  (`seededShuffle('${viewerId}:${activityId}')` — stable across reloads, different across
  viewers, kills position bias) and the lightbox tracks the ENTRY ID, never a list index
  (re-sorts must not swap the viewed entry). **`/votes` is login-walled by layout** (like
  `/videos`) because vote media (`LOCAL_STORAGE_DIR/vote-media/`, served by
  `/api/votes/media/[...key]` with Range) requires auth — an anonymous gallery would 401
  every image. Cover keys echoed by the client are re-validated (shape + on-disk) AND
  refcounted against other activities before accept/unlink (no ownership ledger for
  covers). CSV export: BOM + ASCII filename + Excel formula-injection guard; 排名 computed
  over non-hidden APPROVED entries only (must agree with the published gallery; other rows
  get an empty rank); private accounts' handle (= W3 工号) is trimmed for non-admin
  exporters like department. Admin: featured toggle + soft delete at `/manage/votes`
  (logAdmin'd); hub `/votes` = 精选 band + 进行中(按截止排序)/已结束(冠军封面)/我发起的.
  i18n namespace `votes`; global search bucket `votes` (published only).
  **成员投稿 (migrations `20260817120000_add_vote_submissions` +
  `20260817180000_vote_desc_forms_comments`)**: creator opt-in (`allowSubmissions`) with 审核
  (`submissionReview`, default ON), accepted media, per-user quota, per-file MB cap (null =
  不限, layered UNDER the house caps), per-field form config (作品名/作者/工号/作品描述 each
  必填/选填/关闭 — 作者/工号 default REQUIRED) plus creator-defined CUSTOM form fields
  (`submissionFields` Json, `parseCustomFields`/`resolveCustomAnswers` in lib/votes/shared.ts,
  answers on `VoteEntry.formData`, surfaced in the lightbox 详情 panel / 数据 tab / export,
  gated with titlesVisible) and 投稿须知. **工号 value NEVER comes from the client**: it is
  stamped from the submitter's own `huaweiW3Id` — 'required' always stamps (403
  `huawei_required` when unbound), 'optional' honors an explicit `includeAuthorNo` opt-in
  (blank stays blank — a private user keeps their W3 id off the entry); 作者名 prefills
  editable, backfilled only when required-and-blank. **投票 itself requires a W3-bound
  account when `env.ENABLE_SSO`** (vote route 403 `huawei_required`; `viewer.canVote` in the
  payload drives the disabled state + hint — password-only accounts can browse, not vote).
  `VoteEntry` gained `submitterId`/`status(approved|pending|rejected)`/`reviewNote` + UNIQUE
  `fileKey`/`posterKey` (DB backstop against double-claimed uploads). **Every gallery-facing
  read/count is now `hidden:false AND status:'approved'`** — maintained via
  `recountVisibleEntries` inside the SAME tx as any entry create/delete/hide/review
  (Serializable + P2034 retry). Submission window = published && !voteOver — `startAt`
  gates VOTING only, so publish-empty + future startAt = 先征集后投票 (publish allows 0
  entries when allowSubmissions). Member flow is two-phase like shorts:
  `/api/votes/[id]/submissions/upload` (raw body) then POST `/api/votes/[id]/submissions`
  (re-validates keys shape+on-disk+unclaimed INSIDE the Serializable quota tx; remux/probe
  AFTER the row exists so racing publishes can't double-remux one file; fileKey-unique P2002
  → 400, never retried). Member rows are born `titleEdited=true` (apply-rule never touches
  them); rejected rows don't consume quota; pending/rejected are visible ONLY to their
  submitter (mySubmissions — fetched for any logged-in viewer even if the mode was later
  turned off, or withdraw would vanish) + creator/admin (edit payload, 通过/驳回 in the
  entries table). Submitter may withdraw (DELETE own entry) while the activity isn't over.
  **Round 3 additions**: `VoteComment` (作品评论 — deliberately FLAT plain-text, hard delete,
  NOT the 2-level thread contract; creator toggle `allowComments`; guarded array tx on
  `VoteEntry.commentCount`; list = newest 100 rendered oldest-first — desc scan + reverse,
  an asc take would pin the oldest 100; comments on hidden/unapproved entries 404 for
  non-managers). The lightbox has a right side panel (详情: description/custom answers/rank;
  评论: EntryComments). Gallery renders PAGED (see 「画廊分页 + 卡片缩略图」 below — it was
  a grow-only 48-card window until 2026-10-08) and offers a 榜单 list view when
  results are visible ('shown' feeds both the list and lightbox nav). VoteEditor is 5 TABS
  (基本信息/投票规则/成员投稿/作品/数据); the 数据 tab is the PRIMARY stats surface
  (`/api/votes/[id]/stats` ranked entries + distinct-voter counts; per-entry voter lists
  lazy via `/entries/[entryId]/ballots`; ballot-fetch failures are NOT cached as empty).
  Export is ONE detailed CSV (entry row + indented per-ballot rows, dynamic custom-field
  columns; same privacy trims). Custom-answer rows key on the field `id`, never the label
  (labels can collide). **封面裁切 (migration `20260824000000_vote_poster_crop`)**:
  `VoteEntry.posterAspect` (landscape 4:3 | portrait 3:4 — grid/podium cards render the
  entry's own aspect) + `posterPos` THREE-state ('' = center object-cover, 'contain' =
  full image on blurred backdrop, '50% 30%' = object-position selection), validated by
  `parsePosterPos` on both the submissions POST and the entry PATCH. `PosterCropEditor`
  shows the FULL image with a draggable aspect frame, outside dimmed (= never shown);
  the object-position algebra is p% = frameOffset/(dispImg−dispFrame)·100, and `natural`
  dims MUST reset when imageUrl swaps (stale geometry saves a wrong crop). Entry points:
  SubmitDialog 封面 section (member: custom cover upload replaces the captured frame;
  images crop themselves) and the entries-table 封面 button → `PosterDialog` (creator:
  更换封面图 uploads immediately, crop saves via PATCH). The creator upload route's
  response entry must carry posterAspect/posterPos (a missing field seeds the editor with
  undefined → NaN frame geometry).
  **作品卡片 = Geek Videos 卡片 (2026-08-31, migration `20260831000000_vote_entry_previews_views`)**:
  网格卡片改成和 `components/video/VideoCard.tsx` 同一套版式 —— 画面框里**不再压播放按钮**，
  鼠标悬停直接播片，作品名/作者/统计挪到框**下面**，投票行 `mt-auto` 贴底（同一行里标题
  一行和两行的卡片，按钮仍然对齐，不会在卡片之间留出参差的空档）。三条新契约：
  - **画面框比例只有一份**：`voteCardAspectRatio`/`voteCardAspectClass`（lib/votes/shared.ts）
    —— 横版视频 16:9（对齐 Geek Videos，抓帧封面本来就是这个比例，4:3 框会裁掉两边）、
    横版图片 4:3、竖版一律 3:4。`PosterCropEditor` 的取景框和它的「实际展示预览」小图**必须**
    走同一个函数：取景框比例和卡片对不上，创作者拖出来的 `posterPos` 落到卡片上就是另一块
    画面。加新的卡片尺寸时改这一处，别在调用点重写比例。
  - **悬停只播生成的短片**。`VoteEntry.previewKey/previewUrl` 是 `makeVotePreviewClip`
    （lib/votes/storage.ts，ffmpeg `-ss 0 -t 6`、≤640px 长边、静音、`+faststart`、偶数边
    强制 `trunc(iw/2)*2` —— `force_original_aspect_ratio=decrease` 会给出奇数边，libx264 直接
    报 `width not divisible by 2`）在两条上传路径的 finalize 段生成的；best-effort，没有
    ffmpeg / 排不上队 ⇒ 没有 preview，卡片就只显示封面。老作品用
    `pnpm votes:backfill-previews` 回填。**决定悬停播什么的只有 `pickHoverPreview`**
    （lib/votes/shared.ts）：有 preview 就播 preview；没有时只有原片 ≤ `VOTE_HOVER_SOURCE_MAX_BYTES`
    (64 MB) 才回退播原片，并且只循环开头 8 秒。这是对 Video delivery 那条「绝不回退播原片」
    的**有闸门的**例外，成立的前提是四件事一起在：400ms 悬停延迟、`<video>` 元素**只在悬停
    时才挂载**（一页 24 张卡、同一时刻最多一张在播，常驻媒体元素毫无意义）、
    模块级 `activePreview` 保证全站同一时刻只有一张卡在播、以及 `pause()+removeAttribute('src')+load()`
    的硬卸载。删掉其中任何一件，闸门就不成立了。
  - **浏览数只给发起人/管理员**。`VoteEntry.viewCount` + `VoteEntryVisit`（sessionHash 按
    (viewer, entry, **UTC** 日) 去重 —— 注意这和投票预算的 `voteDayKey` 北京时间日桶是两回事）。
    打开灯箱触发 `POST /api/votes/[id]/entries/[entryId]/view`，计数闸门与阅读闸门一致
    （草稿活动 / hidden / 非 approved 一律 404，且校验作品属于 URL 里的活动）。
    `toVoteEntryView` 按 `isOwner` 裁成 `viewCount: number | null`，和 `voteCount` 同一套家法：
    **服务端裁剪，绝不发了再前端隐藏**。**点击次数 (2026-09-11, migration
    `20260911120000_vote_entry_open_count`)**：`VoteEntry.openCount` 是同一个 ping 的**不去重**
    版本 —— 一个人今天打开五次就是 5（owner 要的是「被点开多少次」的原始热度，👁 浏览人数
    则回答「多少人看过」）。`recordVoteEntryView` 先单独 `increment openCount`，再跑去重
    事务，两条**故意不放同一个事务**：visit 唯一键命中让事务回滚时，点击数照样 +1，这正是
    两个数的差别。同一闸门（草稿/hidden/非 approved 404）、同一裁剪（`openCount: number|null`）、
    同样不含发起人自己。路由回 `{opened, counted}`，客户端按各自的布尔就地 +1
    （去重命中时只动 openCount，否则发起人会看到数据库里没有的数字）。卡片/榜单/灯箱/数据
    tab/CSV 五处并排展示 👁 浏览人数 + 🖱 点击次数（`views_hint`/`opens_hint` 解释口径）。
    发起人自己的打开**不计数**
    （`counted:false, reason:'self'`）—— 这个数字是给他读的，把他自己逐件审稿的痕迹算进去
    就没法看了。前端的计数 effect **必须带停留延迟**（`VIEW_DWELL_MS`）：它的触发单位是
    `lightboxId` 变化，而 ←/→ 正是改这个 id，不 debounce 的话按住方向键就是每秒 ~30 个
    POST，既打爆 240/min 限流，也会给一堆只掠过 300ms 的作品记上浏览。
  - **另外**：`GET /api/votes/[id]` 以前**匿名可读**，而这个 payload 在 实名展示（默认开）
    下带着 作品名/作者名/**工号** —— `/votes` 的页面有 layout 登录墙，这条路由却没有，等于
    绕过墙拿一份工号名册（`/api/search` 同样匿名，能从关键词直接搜到活动 id，链路是通的）。
    现在补了 401。前端唯一的调用方在登录墙里面，没有匿名消费者。

- **`PosterCropEditor` is now a thin wrapper (2026-09-18).** The editor itself moved to
  `components/media/CoverCropEditor.tsx` and the three-state `posterPos` rules to `lib/media/cover-pos.ts`
  (`parsePosterPos` IS `parseCoverPos` — a test pins the identity), because 长视频封面 and 技术专区帖子封面 adopted
  the same contract. The votes wrapper only supplies `voteCardAspectRatio(kind, aspect)` and the `votes.crop_*`
  strings, so nothing on this board changed. Fix a crop bug THERE, once — do not re-grow a copy here.


- **可见范围 (2026-10-07, migration `20261007130000_content_audience_vote_visibility`)** — owner:「结束后可以隐藏，
  而不是只能留在已结束或删除；也可以只给指定的人看」。通用层见 [`audience.md`](audience.md)；投票这边的不变量：
  - `VoteActivity.visibility`（`public` / `private` 隐藏 / `audience` 指定成员可见）+ `ContentAudience kind='vote'` 名单。
    名单授予的是**阅读**权（画廊、详情、按原规则投票/投稿/评论），**不是**共同管理 —— 管理仍然只有发起人和 `votes` 管理员。
  - **闸门只有一处**：`lib/votes/visibility.ts#canSeeVoteActivity`（deleted ⇒ 无；draft ⇒ 仅所有者；然后看可见范围），
    `lib/vote-queries.ts` 再导出。走它的：`getVoteActivityView`（⇒ 页面 404）、ballots POST、作品评论 GET/POST、评论点赞、
    浏览 ping、投稿 POST 与投稿上传、`vote_comment` 翻译加载器。它放在轻量模块里，是为了翻译注册表的测试能跑**真的**闸门。
  - 列表 WHERE 用 `listVisibilityWhere`：进行中/已结束/精选/个人主页（他人视角）/置顶 = `public` + 名单里有我的
    `audience` + 我自己发起的 `audience`。**`private` 不进任何浏览列表**（包括发起人和管理员自己的视角）——它在「我发起的」
    tab、工作台、`/manage/votes`。个人主页本人视角看全部；`countVoteActivitiesByCreator` 现在收 viewer，和列表同口径。
    站内搜索没有查看者身份，只收 `visibility: 'public'`。
  - 写入：`PATCH /api/votes/[id] { visibility, audienceUserIds }`（发起人或 `votes` 管理员），列和名单同一事务；
    管理员改别人的活动记 `logAdmin('set_vote_visibility')`；发布（`publish`）分支改成按 `status:'draft'` 守卫的
    `updateMany`，并用 `newlyGrantedAudience` 通知草稿期就列好的名单。`GET /api/votes/[id]/audience`（仅所有者）给页头的
    「可见范围」弹窗现取现用。
  - 入口：编辑页「基本信息」tab 的「可见范围」区块（独立保存）、画廊页头所有者按钮「可见范围」（`VisibilityDialog`）、
    `/manage/votes` 的「可见范围」列 + 隐藏/取消隐藏开关（取消隐藏一律回到公开；名单只在发起人编辑页维护）。
  - **未闸**、有意为之：`/api/votes/media/[...key]` 仍是「登录 + 不可猜的 nanoid key」（与草稿、隐藏作品同一模型；每张海报多一次
    查库对 X-Accel 热路径不值）—— 一个人在活动被隐藏前拿到的媒体 URL 仍可直接访问。评论删除（作者删自己的）与投稿撤回
    （投稿人删自己的作品）不看可见范围：那是对自己数据的写，不泄露任何东西。
- **标题链接 (2026-10-07, 同一迁移)**：`VoteActivity.slug String? @unique`（lib/slug.ts 契约）。创建时 `freeVoteSlug` 按标题分配
  （冲突重选一次，再冲突留 null）；**草稿期间跟着标题改**（`resyncDraftVoteSlug`，PATCH 回传新 slug，编辑器用
  `history.replaceState` 把地址栏换成新链接），**发布后冻结**。`/votes/[id]` 与 `/votes/[id]/edit` 同时接受 slug / id / 退役别名
  （`resolveVoteParam`），非规范访问 308 到 `voteHref`；**闸门先于重定向**（否则拿 id 就能从 Location 读到隐藏活动的标题）。
  所有链接一律 `voteHref({id, slug}, 'edit'?)`（lib/votes/shared.ts）；API 路由仍按 id。老数据 `lib/votes/slug.ts#backfillVoteSlugs()`。

- **画廊分页 + 卡片缩略图 (2026-10-08)** — owner：「图片和视频一多加载就很慢，做个分页；投票按钮被截断了」。
  改动前实测（58 件、手机原图大小的测试活动）：首屏 24 个媒体请求 **157 MB**，DOM 里 48 张卡且只增不减；
  改动后同样 24 个请求 **2.8 MB**、DOM 里 24 张卡。慢的大头是**图片作品的卡片直接 `<img src=原图>`**（单张上限 50 MB），
  分页只是另一半。三条契约：
  - **分页是分渲染，不是分数据**。`GET /api/votes/[id]` / 页面 payload 仍是整份作品：随机顺序（`seededShuffle`）、
    搜索、草稿预算（`draftBudget` 要看所有 `myVotes`）、灯箱 ←/→、领奖台都依赖整份列表 —— 别把它改成服务端分页。
    `VoteGallery` 只渲染 `shown.slice(page)`：网格 `GRID_PAGE_SIZE=24`、榜单 `LIST_PAGE_SIZE=50`；翻页即卸载上一页
    （图片、解码缓存、悬停播放器一起放掉）。页码 0 起存在 state，`?page=`（1 起，`parseVotePageParam`）用
    `history.replaceState` 同步 —— **不走 router**，force-dynamic 页面的 `router.replace` 会把整份 payload 重拉一遍。
    搜索/排序/切视图在**事件处理里** `setPage(0)`（不是 effect：effect 会在挂载时把 `?page=3` 冲掉）；页号对实际页数
    再夹一次（过滤、轮询、陈旧链接都会让页数变少）。灯箱照旧在整份 `shown` 里翻页；关灯箱走 `closeLightbox`：把网格
    带到最后看的那件所在页并 `scrollIntoView`（卡片带 `data-entry-id` + `scroll-mt-20`，吸顶工具栏不遮）。翻页后
    瞬间（不是 smooth）回到网格顶 —— 平滑滚动会一路扫过新一页的所有卡片、从下往上触发懒加载。页码条是 chrome，全墨。
  - **卡片缩略图**：`voteThumbUrl(url)`（lib/votes/shared.ts，客户端安全）给 `image|poster|cover` 的 jpg/png/webp 存储 URL
    加 `?thumb=1`；媒体路由据此调 `ensureVoteThumb`（lib/votes/storage.ts；纯函数在 lib/votes/thumb.ts）。缩略图**按需生成、
    落盘缓存**，键由原图键推导（`thumb/<kind>-<id>_s640.<jpg|png>`）—— 不进数据库，所以老作品零迁移零回填；
    `deleteVoteMediaFile` 删原图时顺带删缩略图和 skip 标记（派生文件不在任何表里，漏删就是孤儿）。规则：短边 640、不放大；
    原图 < 512 KB 直接给原图；JPEG 出 JPEG、PNG/WebP 出 PNG（透明通道转 JPEG 会变黑底）；gif/avif/视频不做；压出来
    ≥ 原图 70% 或 ffmpeg 读不了 ⇒ 写 `.skip` 标记、以后直接给原图（不为同一个结论反复起 ffmpeg）。用在：画廊卡片、领奖台、
    榜单、大厅 `VoteCard` 封面、编辑页作品表与封面预览、数据面板、我的投稿列表。**灯箱和封面裁切器必须用原图**。
    四个不能「简化」掉的点：
    1. **EXIF 方向自己读**（`jpegOrientation`）+ `-noautorotate` + 显式 transpose/flip。ffmpeg 8.x 会按 EXIF 自动转正图片、
       老版本不会，服务器版本不确定；浏览器显示原图是转正的，`posterAspect` 也按转正后的宽高定。8 个方向已逐像素对过
       ffmpeg 8.1 的 autorotate。
    2. **输入白名单** `image2,jpeg_pipe,png_pipe,webp_pipe` + `protocol_whitelist file`（`inputGuardArgs`）。上传只看声明类型，
       ffmpeg 按内容选解复用器：一份 HLS 播放列表存成 `.jpg`，不设防就会跟着去开别的文件/内网地址。
    3. **走共享 media job 队列**，等槽位 ≤ 8 s；没排上 / 本机没 ffmpeg ⇒ 给原图但 `cache-control: private, max-age=300`
       （不是 immutable —— 否则原图会以缩略图 URL 被浏览器缓存一年）。成品与「最终就给原图」的结论才是 immutable。
    4. 同一张图的并发请求共享一个 job（`thumbJobs`），写 tmp 再 rename。
  - **卡片外壳不许 `h-full`**（这次「投票按钮被截断」的根因）。`EntryCard` 外层是 `-m-1 p-1`（给焦点环留地方）+ `.cv-auto`；
    网格行高按 margin-box 算，`h-full` 再把 border-box 钉成行高，内容就比盒子高 8px，而 `content-visibility: auto` 自带
    paint containment，溢出的 4px 被裁掉 —— 每行最高那张卡的按钮底边被切平。网格项默认 stretch 就够了，flex-col +
    投票行 `mt-auto` 照样贴底对齐。在 `.cv-auto` 元素上加任何「固定高度 + 负外边距」的组合前先想清楚这一条。
  - **深色药丸底色**：`vote-theme.ts` 里 `BUDGET_LEFT` / `STATUS_LIVE` / `STATUS_SOON` 的深色底写成 `dark:bg-*-500/[0.12]`。
    原来的 `/12` 不在 Tailwind 透明度刻度（0、5、10…100）里，根本不生成 CSS，深色模式退回浅色 `bg-*-50`，药丸在黑底上发白。
    改透明度只用刻度值或方括号写法。
