# 动态 / 讨论区与意见反馈 (Discussion, Feedback)

> 从 CLAUDE.md 拆出。两级扁平评论契约的源头在意见反馈板。

- **意见反馈 (Feedback)**: GitHub-issue-style board at `/feedback` (NavBar icon entry).
  `Feedback`/`FeedbackUpvote`/`FeedbackComment` — comments reuse the video board's 2-level flat
  thread contract (`parentId` = thread root; transient `replyToId` for notification routing,
  validated to stay inside the thread; tombstone when replies exist). Counter updates use guarded
  writes inside interactive transactions (see the comment DELETE route) — copy that pattern, not
  the naive check-then-act. Admin moderation is inline on the detail page (status PATCH + delete,
  logAdmin'd); notifications reuse `comment_reply`/`reply_reply` types via `notifyFeedbackReply`.
- **讨论区 (Discussion)**: community hub at `/discussion` — LinkedIn/HF-style 动态 feed
  (`Post`/`PostMedia`/`PostLike`/`PostComment`/`PostCommentLike`) + Discourse-style forum
  (`DiscussionTopic`/`DiscussionUpvote`/`DiscussionReply`); migration `20260729000000_add_discussion`.
  Comments/replies copy the feedback board's 2-level flat thread contract + guarded counter
  transactions verbatim; notifications reuse `comment_reply`/`reply_reply` via
  `notifyPostReply`/`notifyTopicReply` (deep links `/discussion/posts/<id>?focus=<commentId>`,
  `/discussion/topics/<id>?focus=<replyId>`). Post attachments: images reuse `/api/uploads/image`;
  member videos (1 GB cap, faststart remux) + PDF/PPT/Word go through `/api/discussion/upload`
  (per-user daily byte budget) and are served by `/api/discussion/media/[...key]` (login + Range;
  content-disposition built CJK-safe — never put a raw filename in a header). External video links
  render as link cards, NEVER iframes (intranet blocks embeds). Feed paging is an explicit keyset
  cursor encoding `createdAt|id` for sort=new; sort=hot (engagement ordering) pages by offset
  cursor `o:<n>` — do not switch back to Prisma `cursor` (it breaks when the cursor row is
  deleted/pinned); pinned posts are capped at `MAX_PINNED_POSTS` (enforced on pin). **Reactions
  (v2, migration `20260729120000_discussion_v2`)**: LinkedIn-style palette (`PostReaction` enum on
  `PostLike.reaction`; hover the 点赞 button); `Post.likeCount` = TOTAL across types (switching
  types never touches it); the like route returns the authoritative re-read state (races just
  fall through, never 500); "who reacted" panel = `GET .../reactions` + `ReactionsPanel`. Forum v2:
  AI-focused categories (`models/agents/skills/research` added; `general` is legacy — hidden via
  `VISIBLE_CATEGORIES`, still renders on old rows), Discourse sidebar with `countTopicsByCategory`,
  topic rows carry `excerptOf` (code-point-safe slice) + participants + `viewCount`
  (`DiscussionTopicView` day-dedupe; anonymous key = x-real-ip / LAST XFF hop — first hop is
  forgeable). `PostFeed` must stay keyed per stream (`key={q|sort}`) or soft navs mix cursors;
  page searchParams may be `string[]` — always read via `firstParam`.
  **v5 布局 (2026-09-15, NO migration) — the section is now titled 动态 (route unchanged).** Owner:
  「进入讨论区后还需要再点进来分别看，就会分散」「话题的筛选放在头部」「热门讨论表明作者，而不是分类」
  「发布动态改成富文本」「评论不明显，先显示几条再展开」. Tabs are 全部 / 动态 / 讨论
  (`discussionTabOf` in the PLAIN module `app/discussion/_components/tabs.ts` — the RSC calls it;
  全部 = no `tab` param, `?tab=posts`, `?tab=forum`; NAV_MEGA lists the same three).
  **全部** = `listDiscussionStream` (lib/discussion-queries.ts): posts + topics merged by ONE keyset
  `createdAt|id` — each table reads `limit+1` past the cursor, merge, slice; `hasMore` is exact
  without a count; pinned posts lead page 1 and stay out of the stream (listPosts rule), topics stay
  chronological; `q` pages too. API `GET /api/discussion/stream`. `PostFeed mode="all"|"posts"`
  holds `StreamItemView[]` (dedupe key `kind:id`) and renders `PostCard` / `TopicCard`.
  全部 and 动态 share the `HotTopicsRail` (lg+, sticky): `listHotTopics` = upvotes → replies among
  topics active in 30 days, back-filled from all time, pinned is NOT a rank key; rows show rank ·
  title · author avatar+name · replies — no category chips (owner decision). **讨论** tab: the 分类
  filter is a chip bar ABOVE the list (sideways scroll on phones, wraps from sm), no left rail;
  发起讨论 is in the page header for every tab. **Comment previews**: `listPosts` and the stream
  attach `previewComments` (`attachCommentPreviews` — ONE LATERAL statement, top
  `COMMENT_PREVIEW_COUNT`=2 VISIBLE roots per post in 最相关 order, posts with 0 comments skipped);
  `PostCommentPreview` shows them until 查看全部 / 回复 / 评论 swaps in the full `PostComments`
  (`openReplyTo` opens the reply box under that comment, `autoFocusComposer` for 评论). Both use
  `CommentLikeButton` now (the inline ThumbsUp handler in PostComments is gone). Every author in a
  feed payload (post, previewed commenters, topic card + participants) is trimmed by
  `lib/discussion-views.ts` (`publicPost` / `publicTopicCard` / `publicStreamItems`) — add new
  author-bearing fields THERE, for the page and the API at once. The post composer and the post
  edit box are `variant="full"`; @人 already worked everywhere (the toolbar's @ button + typing
  `@`), the placeholders now say so. A client component on this board may only read
  `discussion` / `discussion_ui` — `discussion_pages` is server-only (not in
  CLIENT_MESSAGE_NAMESPACES), which is why `TopicCard` reads `discussion.views_compact`.
  **v3 (migration
  `20260729150000_discussion_v3`)**: topics are MULTI-主题 (`categories DiscussionCategory[]`,
  legacy `category` kept = `categories[0]`; filters compose `AND` of OR-groups — never assign
  `where.OR` twice) and carry attachments (`TopicMedia`, same shape/serving as `PostMedia`).
  **v4 (migration `20260827130000_discussion_tags`) — 分类改为数据表，成员可自建**:
  the `DiscussionCategory` enum is GONE; `DiscussionTopic.category`/`categories` are now
  TEXT/TEXT[] holding `DiscussionTag.slug` (the enum labels WERE the slugs, so the migration
  is a straight `::text` cast — no value backfill). Two tiers, and the split is the whole point:
  `official` tags are the LEFT-RAIL categories (the original 8, seeded, still translated via
  `labels.discussionCategory.*`, curated colors in `badges.tsx#CATEGORY_META`) — filterable,
  counted, and **every topic must lead with one**; member-created tags are `official:false`,
  render as outlined `#name` chips on the topic (hashed color, `tagColorIndex`) and are
  **never in the rail** — that is what keeps the rail a fixed navigation instead of a tag
  cloud (owner decision: 「如果自己创建的，就不会在侧边显示，只会在他的帖子上显示」).
  They ARE globally shared and searchable so two people typing 「RAG」 land on one tag
  (`findOrCreateDiscussionTag` — find-or-create on name, either language, case-insensitive;
  CJK names get a hash slug). The picker (`TopicTagPicker`) renders the 8 official chips flat
  and keeps the custom section COLLAPSED behind a 添加 button — expanding is what hits
  `/api/discussion/tags`; do not pre-flatten the custom list into the form. Quotas are
  SEPARATE and never trade against each other: `MAX_OFFICIAL_TAGS` 3 + `MAX_CUSTOM_TAGS` 3,
  enforced once in the pure `sanitizeTopicTags` (lib/discussion-tags.ts) that BOTH write
  routes call — it also orders official-first, so `categories[0]` is always an official slug
  and the legacy `[category, lastActivityAt]` index stays meaningful. `general` (综合讨论) is
  retired: seeded `official` only if old topics still sit there, excluded from the custom
  candidates, and silently DROPPED by `sanitizeTopicTags` rather than erroring — else editing
  a legacy topic would be a form the author cannot save. Custom chips still link to
  `?category=<slug>`: not in the rail ≠ not browsable. There is deliberately NO admin
  promote-to-sidebar UI yet — the rail set is the 8 enum-era slugs, which is what lets the
  legacy `category` column keep taking a valid old value.
  **正文可引用站内内容**: the topic composer AND the reply composer pass `embedPicker` to
  `RichTextEditor`, so discussion bodies carry the SAME `[embed:<kind>:<ref>]` contract as
  技术专区 — `kinds` is `DISCUSSION_EMBED_KINDS` (everything but `file`, which resolves
  ZonePostAttachment row ids that discussion has no table for). `embedPicker.zoneSlug` was
  deleted, not made optional: the候选 search (`/api/zones/embed/search`) was ALWAYS site-wide
  and viewer-gated, the slug only ever sat unused in an effect dep array. Topic bodies render
  through `ZoneMarkdown` with embeds resolved server-side (`resolveEmbeds(collectEmbedRefs(...))`,
  skipped for anonymous viewers — the embed API requires login and the card degrades itself);
  replies use `ZoneMarkdown` too but let the cards fetch (few, below the fold).
  `app/discussion/layout.tsx` hosts `PreviewProvider` so a card opens the preview drawer —
  it is deliberately NOT login-walled (讨论区 is publicly readable, unlike `/zones`).
  Attachment validation is shared in `lib/discussion-media.ts`: `resolveMedia` (format) +
  `mediaKeysAvailable` (a video/file key already attached elsewhere is rejected — keys are
  visible in URLs, no ownership ledger exists) + `deleteUnreferencedMediaFiles` (refcounts
  PostMedia+TopicMedia before unlinking — NEVER call `deletePostMediaFile` directly from a
  delete path). The client picker is the shared `MediaPicker` (draft in a ref; reports upload
  count outside setState and zeroes it on unmount). Authors render via the identity contract
  (`toPublicAuthor` + `<DeptTag/>`). Admin: pin/lock/delete inline on cards/topic pages +
  tables at `/manage/discussion`, all logAdmin'd.
