# CLAUDE.md — skills-community (AI Community)

Next.js 14 (App Router) + NextAuth/Auth.js v5 + Prisma (PostgreSQL) + pnpm.
Two deploys: **external** (AWS, root path, email/password only) and **internal**
(Huawei intranet, served under `/ai-community` on `cari.rnd.huawei.com`, adds Huawei
W3 SSO). Both login methods coexist; W3 is feature-flagged by `ENABLE_SSO`.

## Dev

```bash
pnpm install
pnpm db:migrate          # prisma migrate dev
pnpm dev                 # next dev (root path, no SSO unless ENABLE_SSO=true)
pnpm typecheck && pnpm test   # tsc --noEmit + vitest; safe while dev runs
```

- **NEVER `pnpm build` while `next dev` is running** — it corrupts `.next`. Use
  `typecheck`/`test` to verify instead.

## Internal deploy (under `/ai-community`)

Full guide: `docs/huawei-sso-deploy.md`. Artifacts: `.env.ai-community.example`,
`deploy/ai-community.nginx.conf`, `deploy/ai-community.service`. Sequence on the box:

```bash
cp .env.ai-community.example .env     # fill DATABASE_URL, AUTH_SECRET, SSO_CLIENT_ID/SECRET
pnpm install
pnpm prisma migrate deploy
NEXT_BASE_PATH=/ai-community pnpm build
# Start (foreground test) — see pitfall #1, do NOT use `pnpm start -- -p`:
NEXT_BASE_PATH=/ai-community pnpm exec next start -p 3100 -H 127.0.0.1
# Production: run as systemd — see docs/huawei-sso-deploy.md "Run it as a systemd service".
```

systemd (production): `deploy/ai-community.service` is preset for this box (`WorkingDirectory=/home/eason/projects/ai-skills-community`, `User=eason`, `NEXT_BASE_PATH=/ai-community`). `sudo cp` it, set `ExecStart`'s node to your `which node` (absolute — systemd ignores your nvm/conda PATH), `daemon-reload`, `enable --now`. After `git pull` on the server: `NEXT_BASE_PATH=/ai-community pnpm build && sudo systemctl restart ai-community`.

## Pitfalls (each one cost real time — read before deploying)

1. **`pnpm start -- -p 3100` is broken** on pnpm v8+ — the `--` leaks into `next`, which
   then treats `-p` as a directory (`Invalid project directory ... /-p`). Use
   `pnpm exec next start -p 3100 -H 127.0.0.1`, or in systemd call node directly
   (`/usr/bin/node node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1`).
2. **`next start` needs a prior production build.** `Could not find a production build in
   '.next'` ⇒ run `NEXT_BASE_PATH=/ai-community pnpm build` first. `pnpm build` also
   validates `.env` (it throws on a bad `DATABASE_URL`/missing `AUTH_SECRET`), so fill
   `.env` before building. The foreground server holds the terminal — that's "running",
   not "stuck"; use systemd for real deploys.
3. **nginx on this box is NOT managed by systemd.** `systemctl reload/restart nginx` fails
   (`nginx.service is not active`) and `nginx -s reload` fails too (`/run/nginx.pid` is
   empty). Reload by signalling the master directly:
   `sudo ps -o pid,ppid,args -C nginx` → `sudo kill -HUP <master-pid>`. **Do NOT
   `systemctl restart nginx`** — it won't come back and takes down ai4news/cari_dste too.
4. **Subpath + Auth.js v5 is the deep one.** Next strips `NEXT_BASE_PATH` from inbound
   route-handler URLs, but Auth.js must build `/ai-community`-prefixed OAuth callbacks.
   The working combination (all already wired — don't "simplify" it away):
   - `next.config.mjs`: `basePath` from `NEXT_BASE_PATH` (also exposes `NEXT_PUBLIC_BASE_PATH`).
   - `lib/auth.ts`: `basePath = <NEXT_PUBLIC_BASE_PATH>/api/auth` (so callbacks build correctly).
   - `lib/auth-handlers.ts`: **re-adds** the stripped basePath to inbound requests, else
     `UnknownAction: Cannot parse action at /api/auth/...` + "Bad request" on every login.
   - `components/AuthProvider.tsx`: `SessionProvider basePath` so client `signIn/signOut`
     hit `/ai-community/api/auth/*`, not the host root.
   - `HuaweiLoginButton`: post-login `callbackUrl` is `withBasePath()`-prefixed (W3 ends in a
     server redirect that Next does NOT auto-prefix; credentials login uses the router, which does).
   - `.env`: `AUTH_URL=https://cari.rnd.huawei.com/ai-community/api/auth` (must end `/api/auth`);
     `NEXT_BASE_PATH=/ai-community` must be present **at build time**.
5. **nginx `^~ /ai-community/` block: NO trailing slash on `proxy_pass`** (preserve the
   prefix for Next's basePath — opposite of `/cari_dste/`). `^~` stops asset regexes from
   hijacking `/ai-community/_next/*`.
6. **Redirect loop ("redirected you too many times") on `/ai-community`.** Do NOT
   `return 301 /ai-community/` for the bare path — Next serves the basePath root WITHOUT a
   trailing slash and 308-redirects `/ai-community/` → `/ai-community`, so the 301 fights it
   forever. **Proxy** the bare path to the app instead (`location = /ai-community { proxy_pass … }`)
   and let Next canonicalize. Don't "fix" it with `trailingSlash: true` in next.config — that
   would add a slash to the OAuth callback path and break the W3 callback.
7. **systemd unit (`deploy/ai-community.service`).** systemd does NOT load your nvm/conda PATH,
   so `ExecStart` needs the absolute `which node` and the FULL command
   `<node> node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1` (a bare `<node> start`
   fails). `status=200/CHDIR` ⇒ `WorkingDirectory` doesn't exist (usually a stale placeholder —
   re-`cp` the unit after editing). Re-check the node path after `nvm install` (the nvm path
   embeds the version). `.env` is auto-loaded by Next from `WorkingDirectory` — don't use
   systemd `EnvironmentFile=` (its inline `#` comments would corrupt values).
8. **`/manage` admin gate lives in `app/manage/layout.tsx` via `requireAdmin()` (server-side
   `auth()` + isAdmin), NOT edge middleware.** `getToken()` in edge middleware can't see the
   secure session cookie behind the proxy+subpath, so it false-negatives logged-in admins and
   bounces them to a (wrong-host) login. There is intentionally no `middleware.ts`.
9. **Client `fetch('/api/...')` must carry the basePath.** Root-relative client fetches resolve
   to `<origin>/api/...` (origin root → neighbour app/404), not `/ai-community/api/...`, so every
   client-side write breaks under the subpath while RSC reads work. Fixed globally by
   `lib/patch-fetch.ts` (`installApiBasePathFetch()`, installed in `components/AuthProvider.tsx`):
   it patches `window.fetch` once to prepend the basePath to same-origin root-relative URLs.
   No-op at root. So you can keep writing plain `fetch('/api/...')`; don't remove the shim.
   **But the shim does NOT cover `<img src>` / `<video src>`** (they're not `fetch`) — any element
   rendering a stored root-relative media URL must wrap it in `withBasePath()` at render time.
   `components/Avatar.tsx` and the video components do this; if you add a new `<img src={…url}>`,
   wrap it or the image 404s under `/ai-community`.

## Conventions

- Store media URLs root-relative; apply `withBasePath()` (`lib/base-path.ts`) at render time
  so content stays portable across root vs `/ai-community` deploys.
- Env is validated by `lib/env.ts` (zod). Read config via `env`, not `process.env`
  (except `NEXT_PUBLIC_*`, which are build-time inlined). Env changes need a **restart**,
  never a rebuild — `lib/env.ts` parses the whole `process.env` object at import, so nothing
  outside `NEXT_PUBLIC_*` / `NEXT_BASE_PATH` is baked into the build.
- **Outbound egress** (`lib/net/proxy.ts`): the intranet box has NO direct route to the public
  internet, so every server-side call that leaves it must go through `egressFor(url)` (undici)
  or `egressFetch` (global fetch) — never a bare `fetch`/`undiciRequest`. Routing is **per host,
  not a global switch**: external → corporate proxy, `PROXY_BYPASS` hosts (default
  `.huawei.com` + RFC1918 + loopback) → direct, because the proxy refuses internal destinations.
  That's what keeps W3 SSO (`lib/auth.ts` derives `useProxy` from `hostBypassesProxy`) and the
  10.x vLLM working while 知识库 fetches the public web. Four non-obvious traps: undici ignores
  `HTTP(S)_PROXY` (we parse them ourselves); `new ProxyAgent('http://…')` — the **string** form —
  silently drops `requestTls`, so the MITM cert is checked against Mozilla roots and every https
  fetch dies with `unable to verify the first certificate` (use the object form);
  `NODE_EXTRA_CA_CERTS` only works as a systemd `Environment=` line — Node builds its trust store
  before Next loads `.env`, so `PROXY_CA_FILE` is the `.env`-friendly alternative; and a
  npm-undici dispatcher must ride npm-undici's OWN `fetch`/`request`, NEVER Node's built-in fetch —
  the bundled undici's handler contract drifts across majors, so Node 24 + undici 8 rejects every
  dispatched call with `UND_ERR_INVALID_ARG: invalid onRequestStart method` (this broke W3 login:
  `SSO_VERIFY_SSL=false` attaches an insecure Agent in `lib/auth/huawei-fetch.ts`, whose
  token/userinfo calls then died as `CallbackRouteError: fetch failed`). Diagnose live
  at 管理后台 → 知识库 → "网络出口 (Proxy) 诊断" (`/api/admin/egress-test`), which reports the raw
  errno + `cause` + chosen route that the user-facing toasts collapse.
  **LLM calls are the exception**: `lib/llm/egress.ts` (`llmFetch`) is DIRECT unless
  `LLM_USE_PROXY=true`, because the intranet model may sit on a non-RFC1918 internal range that
  no bypass list can classify — proxying it is what breaks 知识库 AI 解析. It also rewrites the
  useless `TypeError: fetch failed` into endpoint + route + errno, so an unreachable model shows
  up on the doc row instead of a blank 解析失败. Test it live with 测试连接 in the 知识库 AI 模型
  card (`/api/admin/library/llm-test` — real completion, raw error). When the model DOES answer
  but the JSON won't parse (a reasoning model cut off mid-`<think>` is the usual cause),
  `explainParseFailure` (`lib/llm/explain.ts`) stores an excerpt of the actual reply in `aiError`.
- **Reasoning models (GLM / Qwen-thinking / DeepSeek-R1) are the default on the intranet**, and
  nearly every 知识库 AI failure traces to their `<think>` block. The invariants:
  - **Never cap `max_tokens` for a JSON-returning call.** `lib/llm/openai.ts` omits the field
    entirely when `maxTokens` is unset so the server uses the remaining context window; a cap is
    what truncated the reply mid-thought and produced "模型没有按要求返回 JSON". Anthropic's API
    *requires* the field, so that provider alone keeps a (generous, 8192) default.
  - **`extractJsonObject` (`lib/skill-assist.ts`) is the single JSON gate** for indexing, retrieval
    and skill assist. It takes everything after the LAST closing reasoning tag (`</think>`,
    `</thinking>`, `</reasoning>`, `</thought>` — GLM prefills the OPENER so it may never be
    emitted), returns null on an unterminated opener (the answer never arrived — let the caller
    report truncation), tries EVERY candidate `{`, deprioritizes schema echoes (`{"name":"..."}`)
    and `{}`, and repairs truncated/near JSON. It deliberately does NOT strip ``` fences —
    a blanket strip destroyed code blocks inside a generated `descriptionMd`.
  - **Streamed answers go through `stripThinkDeltas`** (`lib/llm/sse.ts`) on the OpenAI-compatible
    path only — Anthropic already filters to `text_delta`. Without it the chain of thought lands in
    the chat bubble AND is persisted into `LibraryChatMessage`, then re-sent as context.
  - **The real fix is server-side**: 管理后台 → 知识库 → 关闭思考 sets
    `chat_template_kwargs.enable_thinking=false` (top-level, NOT `extra_body`). It is an admin
    toggle, not env, because it is a per-model wire detail — and it MUST stay opt-in: vLLM
    accepts-and-ignores unknown fields, but `api.openai.com` hard-400s them.
  - `force: true` on reindex clears the `aiSummary: ''` parse-failure checkpoints; without that
    reset 重新索引 is a no-op on exactly the chapters that failed.
- **Notifications** (`lib/notifications.ts`): in-app `Notification` rows + best-effort email,
  both gated per-user by `NotificationPreference` (Settings → 通知). Emit from the mutation
  site (comment reply, access request/decision, announcement fan-out) — never let a
  notification failure break the underlying write. The bell (`components/NotificationBell.tsx`)
  polls `/api/notifications`; a click deep-links to `/videos/<slug>?focus=<id>` (scroll +
  highlight, auto-expand thread) or `/announcements/<id>`. Admins publish via `/manage/announcements`.
- **SMTP** (`lib/email.ts`): sends only when `SMTP_HOST` **and** `SMTP_FROM` are set. The intranet
  relay (`email-ca.huawei.com:25`, the one the `news` app uses) is **plaintext** — set
  `SMTP_PORT=25 SMTP_SECURE=false SMTP_IGNORE_TLS=true`; the transport already sets
  `tls.rejectUnauthorized:false` + timeouts. Diagnose live at 管理后台 → 公告 → "邮件 (SMTP) 诊断"
  (it calls `sendMailRaw`, which throws the real error instead of swallowing it).
- New Prisma migrations ship as committed SQL under `prisma/migrations/`; apply on the server
  with `pnpm prisma migrate deploy` (the `Notification`/`Announcement`/`NotificationPreference`
  tables are added by `20260629000000_add_notifications_announcements`; `SkillPack`/`SkillPackItem`
  by `20260701000000_add_skill_packs`).
- **合集包 (Skill Packs)**: admin-curated bundles (`SkillPack`/`SkillPackItem`; a skill can be in
  many packs). Browse tab `?source=packs`, detail `/packs/<slug>`, CLI `skills install pack:<slug>`
  (variadic install too) resolves `GET /api/packs/<slug>/manifest`. Admin CRUD at `/manage/packs`
  (+ AI `pack` assist action). Members must satisfy `INSTALLABLE_SKILL_WHERE` (lib/pack-queries.ts):
  published, not deleted, not private — enforced again in `lib/pack-admin.ts` on save.
- **Download caps**: `lib/download-limit.ts` (rolling 24h vs `User.dailyDownloadLimit`) is shared by
  `/raw` AND the `/api/storage` proxy — any new byte-serving route must call it. Never trust a
  `?via=` query value beyond `install|update` (`via=try` is server-side only; a client-supplied one
  would dodge the cap). `canUseCli=false` invalidates PATs in `lib/auth/cli.ts`.
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
  page searchParams may be `string[]` — always read via `firstParam`. **v3 (migration
  `20260729150000_discussion_v3`)**: topics are MULTI-主题 (`categories DiscussionCategory[]`,
  legacy `category` kept = `categories[0]`; filters compose `AND` of OR-groups — never assign
  `where.OR` twice) and carry attachments (`TopicMedia`, same shape/serving as `PostMedia`).
  Attachment validation is shared in `lib/discussion-media.ts`: `resolveMedia` (format) +
  `mediaKeysAvailable` (a video/file key already attached elsewhere is rejected — keys are
  visible in URLs, no ownership ledger exists) + `deleteUnreferencedMediaFiles` (refcounts
  PostMedia+TopicMedia before unlinking — NEVER call `deletePostMediaFile` directly from a
  delete path). The client picker is the shared `MediaPicker` (draft in a ref; reports upload
  count outside setState and zeroes it on unmount). Authors render via the identity contract
  (`toPublicAuthor` + `<DeptTag/>`). Admin: pin/lock/delete inline on cards/topic pages +
  tables at `/manage/discussion`, all logAdmin'd.
- **活动 (Events)**: Luma-style community event calendar at `/events` (`Event`/`EventSpeaker`;
  migration `20260730120000_add_events`). 大类 = `EventKind` enum (external/internal/
  expert_talk/seminar), 小类 = `topics String[]` from the fixed `EVENT_TOPICS` taxonomy in
  `lib/events/types.ts` — two orthogonal facets, don't merge them. 城市 and 时区 are ALSO fixed
  option sets there (`EVENT_CITIES`; `EVENT_TIMEZONES` = 东部/中部/西部/北京 as IANA zones).
  **Time model**: timed events store REAL UTC instants + the organizer's IANA `timezone`
  (`zonedWallToUtc` in `lib/events/time.ts`, Intl-based, no tz dep); the UI converts to each
  viewer's browser zone via the `EventTime*` client leaves (SSR deterministically renders the
  event's own zone, a post-hydration effect swaps in the viewer zone — no mismatch). ALL-DAY
  events are date-only (UTC midnight, `timezone` null) and never converted; legacy null-zone
  timed rows count as the default zone. Because the zone set is CLOSED, date filters compile to
  exact per-zone SQL branches (`rangeWhere`/`upcomingWhere` in `lib/event-queries.ts`) — 即将举行
  keeps an event until its last day ends in its OWN zone. List grouping/calendar dots key on
  `eventLocalDayKey` (event-own-zone date); multi-day events dot every grid day (window-clamped
  expansion) but appear ONCE in the list; a day filter collapses the list under the SELECTED
  day header. `meetingUrl` is member-only — trimmed server-side in `toPublicEvent` for anonymous
  viewers and left out of the .ics. Permissions: content edits author-only (the PATCH route
  branches on `title` in the body); `pinned` admin-only (cap `MAX_PINNED_EVENTS` enforced on
  pin; strip dedupes against the timeline); `cancelled` author-or-admin (stays visible, badge +
  【已取消】calendar-title prefix); DELETE is soft (`deletedAt`) — any new Event read must filter
  `deletedAt: null` (lib/search.ts does too). Speakers are replaced wholesale on edit (delete +
  create in one transaction; detail page renders them as square-avatar profile cards).
  添加到日历 = UTC(`Z`) Google link built client-side (needs window.origin) + `/api/events/[id]/ics`
  — all-day DTEND is EXCLUSIVE (+1 day) and the download filename stays ASCII-only.
  **我要参加 / 提醒 (migration `20260807000000_add_event_attendees`)**: `EventAttendee`
  (composite PK) + denormalized `Event.attendeeCount` via guarded array transactions
  (like-route pattern — races fall through to the authoritative re-read). Toggle =
  `POST /api/events/[id]/attend`; join is gated (no cancelled/finished events) but LEAVE always
  works, and the detail-page card stays visible to an attending viewer after 取消/结束 so
  「我参加的」can be cleaned up. `?mine=1` is a FACET (`EventFilters.mineFor`, viewer id only —
  never client input) composing with tabs/calendar/counts; ignored for anonymous. Attending
  cards get an accent border + 已参加 badge. **Reminders**: joining IS the opt-in (deliberately
  NOT gated by `NotificationPreference`); `lib/events/reminders.ts` sweeps timed, live events
  starting within ~35 min and notifies un-reminded attendees (in-app `event_reminder` + email),
  claiming rows ATOMICALLY via `updateMany(remindedAt: null → now)` so concurrent sweeps never
  double-send. Trigger paths: throttled piggyback on `GET /api/notifications` (the bell polls it
  while anyone is online) + `scripts/send-event-reminders.ts` for real cron (`*/5 * * * *`) —
  keep both. All-day events are skipped (no meaningful "30 min before").
  **Card UX (migration `20260807120000_add_event_cover_pos`)**: list cards carry a compact
  `CardAttendButton` (rendered whenever the event is joinable — anonymous clicks get the house
  401 toast + login redirect, so the server card needs no session). Covers open in
  `ImageLightbox` — it MUST portal to `<body>` (`card-hover`'s hover transform creates a
  containing block that traps `fixed` overlays). Detail cover: `Event.coverPos` null ⇒ full
  image shown blur-contain INSIDE the 2:1 frame (nothing truncated); set ⇒ object-cover with
  that CSS object-position — the uploader picks it by dragging in `CoverEditor` (2:1 取景框,
  pointer-capture drag, '' = 完整显示; a crop without a cover is never stored). Detail page
  section order: 讲师/嘉宾 ABOVE 活动介绍; right rail ends with 相关活动
  (`listRelatedEvents`: upcoming + live, same kind OR overlapping topics, ≤4).
- **随刷短视频 (Shorts, migration `20260811000000_add_short_videos`)**: TikTok-style vertical
  swipe feed riding the EXISTING Video board — shorts are `Video` rows with `isShort: true`
  (member `sourceType: user_uploaded`, published-public on create), reusing VideoLike/VideoFavorite/
  VideoComment (+CommentSection in a drawer)/VideoView and the videos file route. **Every Video
  read must now decide about `isShort`**: `PUBLISHED_PUBLIC` (lib/video/queries.ts), lib/search.ts,
  /manage/videos (+its edit page and the admin PATCH/DELETE `/api/videos/[slug]`, which 404 shorts —
  their DELETE hard-unlinks files, shorts soft-delete keeps them) all filter it; `favoriteVideos`
  deliberately does NOT (稍后看 is the only favorites surface; short cards deep-link fine because
  `/videos/[slug]` redirects shorts → `/videos/shorts?v=<id>&focus=…`, which keeps comment
  notifications working). Feed `/videos/shorts` (app/videos/shorts/): scroll-snap `y mandatory` +
  `scroll-snap-stop: always`, ONE IntersectionObserver max-ratio active detection, real `<video>`
  only at active ±2 (decoder windowing is correctness, not perf), muted-first autoplay with
  persisted unmute (`localStorage shorts:sound`) + play()-rejection tap-to-play fallback, keyset
  `createdAt|id` / hot `o:<n>` cursors (lib/video/shorts-queries.ts). Member upload =
  `/api/shorts/upload` (raw-body protocol, 500 MB/5 min caps, own 2 GB/day ledger, faststart remux);
  publish = POST `/api/shorts` re-validating echoed keys (shape + on-disk + not-attached-elsewhere)
  and ffprobe-ing REAL duration when available (client value is advisory). Views count ONLY via the
  deduped `/api/shorts/[id]/view` (VideoView sessionHash; the long-video +1-per-open ping 404s
  shorts — viewCount ranks the hot feed). AI 文案润色 lives in `lib/video/shorts-caption.ts`,
  SERVER-ONLY (its extractJsonObject chain reaches yauzl/node:crypto — client components import
  only the import-free `lib/video/shorts-shared.ts`). 精选 (admin `featured`, /manage/shorts or
  PATCH `/api/shorts/[id]`) feeds every embed surface (`featuredShorts`: featured first, hot
  backfill). i18n namespace `shorts`.
  **ONE player code path**: `ShortsCell` (app/videos/shorts/_components/) is THE short player —
  rail (赞/评论/收藏/分享/字幕/静音), caption + uploader + date, drag-seek, double-tap like, view
  ping. `ShortsShowcase` (app/_components/home/) is a chrome-only wrapper (slide transitions,
  wheel/touch/chevrons/dots/counter/fullscreen, play-only-in-viewport) — NEVER fork a second
  player; embeds pass `embed` + `onEnded` and route comments to `/videos/shorts?v=<id>&comments=1`
  (drawer auto-opens; `?upload=1` auto-opens the upload dialog — the visible entry points).
  Surfaces: homepage hero band v3 (left: welcome→今日简报→热门Skills 2×2; right: full-height
  showcase), GeekHub `/videos?tab=shorts` (Douyin-style: showcase hero + side cards + vertical
  card grid), and the immersive feed. RSC boundaries build items via
  `annotateShortsViewer`+`toShortView` (lib/video/shorts-queries.ts) — never hand-map.
  **字幕 (subtitles)**: `lib/video/subtitles.ts` — best-effort local ASR + translation, fired on
  publish and via POST `/api/shorts/[id]/subtitles` (author/admin). ffmpeg extracts 16k wav →
  a LOCAL whisper binary transcribes to VTT — ZERO-CONFIG discovery for pull-only servers:
  binary = `WHISPER_BIN` override, else `whisper-cli` on PATH → `~/whisper.cpp/build/bin/whisper-cli`
  (systemd PATH lacks user builds) → `whisper` (openai-whisper, model NAME via WHISPER_MODEL);
  ggml model = `WHISPER_MODEL` override, else best `ggml-*.bin` in `~/models/` or
  `<LOCAL_STORAGE_DIR>/models/` (large-v3-turbo → … → tiny) → house LLM
  (getLibraryProvider) translates cues 中↔EN (unavailable ⇒ original track only, noted in
  `subtitleError`). Tracks stored as `subtitle/<nanoid>.vtt` in the videos storage (file route
  serves text/vtt), columns `subtitleStatus/SrcLang/ZhKey/ZhUrl/EnKey/EnUrl/Error/At`
  (migration `20260813000000_add_short_subtitles`); pure VTT helpers in
  `lib/video/subtitles-shared.ts` (unit-testable, no env). Player renders `<track>`s and drives
  `textTracks[].mode` imperatively; selector cycles 关→中→EN, persisted `shorts:subtitle`;
  `video::cue` styled in globals.css.
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
- **员工名单 (Employee Directory)**: admin roster at `/manage/employees` (`EmployeeDirectory` model;
  bulk import via paste / CSV / XLSX — parsers in `lib/employee-import.ts`, merge rules in
  `lib/employee-admin.ts`; 工号 canonicalized to lowercase at write time — the DB unique index is
  case-sensitive, app lookups are not). Rows with 工号 push `User.department`/`lab` onto matching
  users on every create/update/import, via the manual 同步 button, AND at login (`signIn` callback,
  best-effort). Match = `huaweiW3Id` ONLY (case-insensitive; `lib/employee-directory.ts`) — NEVER
  the handle: it derives from the unverified email local part under open registration, so matching
  it would let `<工号>@any.tld` squatters inherit an employee's 部门/研究所 and harvest the roster.
  Deleting an entry never touches users; 停用 (isActive=false) entries are excluded from all sync.
- **隐私账号 & identity display**: `User.isPrivate` toggle at Settings → 隐私. Contract
  (`lib/user-identity.ts`): author queries select `AUTHOR_IDENTITY_SELECT` and every server
  boundary (RSC props / API JSON) maps through `toPublicAuthor(author, viewerIsAdmin)` so a private
  user's department/lab are stripped SERVER-side (never shipped-then-hidden); UI renders
  `<DeptTag/>` (`components/DeptTag.tsx`) next to names and hides the `@handle` TEXT when
  `isPrivate` (profile links keep working; handle stays in payloads for ownership checks).
  Admins always see full identity (and a 隐私 badge in /manage). Any NEW surface that renders
  another user's identity must follow this select → trim → DeptTag pattern.
- **Video delivery**: the file route (`app/api/videos/file/[...key]`) streams from local disk with
  HTTP Range. Under concurrency the bottleneck is that bytes flow through Node — set
  `VIDEO_X_ACCEL_REDIRECT=true` + add the internal `/_video/` nginx location (see deploy conf)
  to offload byte-serving to nginx `sendfile` (Node only does `auth()` then returns the header).
  Card/hero hover previews use ONLY the dedicated short `preview` clip (never the full source) —
  don't reintroduce a `?? videoUrl` fallback. Not yet done (needs ffmpeg on the box): `+faststart`
  remux on upload (fixes tail-`moov` first-frame delay) and HLS/adaptive transcoding.
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
- **i18n (中/EN/FR) — no hardcoded UI strings**: every user-visible string lives in
  `messages/{zh-CN,en,fr}.json` (zh-CN is the source of truth; all three files must stay at
  **key parity** — the merge script in the i18n work checks this, and a missing key renders the
  raw key path in prod). Read via `useTranslations('<ns>')` (client) / `await getTranslations('<ns>')`
  (server RSC); the locale comes from the `locale` cookie (设置 → 语言) with Accept-Language as the
  first-visit default (`i18n/request.ts`). Rules that cost real time:
  - **`labels` is the shared taxonomy namespace** — `docType.*`, `discussionCategory.*`,
    `eventKind.*`, `eventMode.*`, `visibility.*`, `skillStatus.*`, `libCategory.*`. The Chinese
    label maps still in `lib/**` (`DOC_TYPE_LABELS`, `CATEGORY_META`, `EVENT_KINDS`…) are kept for
    **enumeration, slugs, colors and DB values only** — render the *display* string through
    `` tl(`docType.${v}`) ``. Never translate a value that is stored, filtered on, or sent to an API
    (`EVENT_CITIES` entries are Chinese *DB values* — display-only translation).
  - **Relative dates must go through `relativeTime(date, locale)`** (`lib/i18n-date.ts`).
    Bare `formatDistanceToNowStrict` is English-only and leaks "3 days ago" into the 中文 UI.
  - ICU plurals for en/fr (`{count, plural, one {# comment} other {# comments}}`); the zh value is
    the exact original Chinese. Never put a raw `'` right before `{`/`}` (it escapes the brace).
  - **A literal `<…>` in a message value must be written `'<…>'`.** next-intl parses `<slug>` as a
    rich-text tag and fails the WHOLE message with `INVALID_MESSAGE: UNCLOSED_TAG`, silently
    rendering the raw key path (`docs_page.foo`) in the UI. The quotes are consumed by ICU, so the
    reader still sees `<slug>`. This bites the docs pages, which are full of `<slug>` placeholders.
  - `.ts` helper modules (stores, stream/parse helpers) must NOT import next-intl — callers pass
    translated text in.
  - **`/manage` admin UI stays Chinese by design** (internal ops tool); notification/email bodies are
    stored data, not UI, so they don't follow the viewer's locale either.
- **Profile vs Dashboard (deliberately different products)**: `/users/[handle]` is the **public
  showcase** — skills, library submissions, posts, forum topics, recent comments, shelf, events —
  every row deep-links into the real surface. `/dashboard` is the **private workspace** (drafts,
  subscriptions with update flags, pending download requests, edit/manage buttons). Don't merge them,
  and don't add owner-only tooling to the profile beyond the small "面板 / 隐私 / 设置" links.
  Per-section visibility is user-controlled via six `User.showProfile*` booleans (migration
  `20260730213610_add_profile_section_visibility`, toggles at Settings → 隐私). Same contract as
  `isPrivate`: `lib/profile-queries.ts` gates each section **server-side** — a hidden section is
  never queried for other viewers, so its rows never reach the client. Owner + admins always see
  everything, marked with a 仅自己可见 badge. Shelf/comment/doc sections only ever surface
  `visibility: public` + `status: ready` docs, even for the owner.
- **Skill upload has exactly ONE entry**: the 上传 Skill button on `/skills` (Skills Center).
  It was removed from the user menu on purpose — the avatar dropdown is navigation to *your own*
  surfaces (主页 / 面板 / 书架 / 设置), not an authoring action.
