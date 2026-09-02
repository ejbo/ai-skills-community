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
8. **`/manage` gates are server-side, NOT edge middleware.** The layout (`app/manage/layout.tsx`)
   admits any *staff* role via `getManageActor()` and filters the nav by permission; **every section
   page then calls `requirePermission('<domain>')`** (`lib/admin.ts`) and every `/api/admin/*` route
   uses `gateApi('<domain>')` — both read the role from the DB, so a revoked role locks out on the
   next request. `getToken()` in edge middleware can't see the secure session cookie behind the
   proxy+subpath, so it false-negatives logged-in admins and bounces them to a (wrong-host) login.
   `middleware.ts` exists but does ONE thing — publish `x-pathname` (see 登录跳转 below) — and
   **no auth decision may ever move into it**.
8b. **登录后回到原来的页面 (2026-08-27).** A shared deep link into a login-walled surface used to
   dump the visitor on the homepage after signing in, because `requireUser()` redirected to a bare
   `/auth/login`. Three parts, and they only work together:
   - `middleware.ts` is HEADER-ONLY: it sets `x-pathname` (basePath-free, query included) and
     nothing else. A layout gets no pathname prop and Next 14 sets no such header itself, so this is
     the only way `app/{zones,videos,votes}/layout.tsx` can name the route they are gating. Its
     invariants are in the file and each is load-bearing: CLONE the inbound headers (Next deletes
     every header not in the override set — a bare `new Headers()` drops `cookie` and
     `accept-language`), set NO response headers, keep the bare `'/'` matcher entry (a `'/(…)'`
     pattern cannot match `/ai-community` itself — the `location = /ai-community` nginx block,
     pitfall #6), and remember `.set()` only overwrites a spoofed value on matcher-COVERED paths —
     never read `x-pathname` in an `/api` route. **A deploy must rebuild**: a `.next` built before
     the file existed silently runs no middleware and re-opens the spoof.
   - **`loginHref()` / `currentLoginHref()` / `selfHref()` (`lib/auth/callback-path.ts`) are the ONLY
     way to build a login link.** Never hand-write `` `/auth/login?callbackUrl=${pathname}` `` again:
     the literals dropped the destination, one produced a double `?` (`/skills/x?tab=reviews`), and
     none stripped the deploy basePath — so `withBasePath()` on the far side double-prefixed it.
     In a client event handler use `currentLoginHref()` (reads `window.location`, so it keeps the
     query — `usePathname()` has none and `useSearchParams()` would opt the route out of static
     rendering); in an RSC gate pass `requireUser(selfHref(base, searchParams))` where the route
     knows itself, so the fallback survives even a stale build.
   - `sanitizeCallbackPath` compares the PATH part when stripping the basePath. `/ai-community?tab=x`
     is the deploy root with a query and @auth/core produces exactly that shape (it bounces to
     `pages.signIn` with the absolute stored callbackUrl); whole-string matching missed it. It also
     **rejects C0 control characters anywhere in the value** — WHATWG URL parsers REMOVE tab/CR/LF
     before parsing, so `/<TAB>/evil.example` walked past the `//` check, Node put the raw byte in
     the `Location` header and the browser then read `//evil.example` as scheme-relative and left
     the origin. That was a live open redirect on the ROOT deploy (the `/ai-community` prefix
     neutralised it by accident). `loginHref` additionally refuses `/auth/*` destinations, so the
     navbar link may render on the login/error pages without nesting itself.
   - A failed W3 attempt is the one case the callbackUrl cannot survive on its own: @auth/core puts
     ONLY `?error=` on `pages.error`, and the `aic.callback-url` cookie is path-scoped to
     `/api/auth`. `HuaweiLoginButton` therefore leaves a sessionStorage breadcrumb
     (`lib/auth/pending-dest.ts`) that `app/auth/error/AuthRetryLink.tsx` reads after mount.
   The W3 round trip is unchanged — `HuaweiLoginButton` still does `withBasePath(sanitize(…))`
   (pitfall #4) and the callbackUrl still rides the `aic.callback-url` cookie, never the state.
   **自助注册已关闭** on every deploy (owner decision): `/auth/signup` redirects to the login page
   (the route is KEPT — `tests/page-visit.test.ts` enforces `app/**/page.tsx` ↔ `PAGE_NAMES` in both
   directions), `POST /api/auth/register` always 403s, and the login page has no signup link.
   Accounts come from W3 first login (`signIn` callback) or `pnpm db:seed`; there is no admin
   create-user UI, so re-opening a path is a real decision, not a toggle.
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
10. **W3 login dying with `InvalidCheck: state value could not be parsed` = hostname-alias cookie
    split, NOT a code bug.** The cari server block also answers on its pre-2026-07 name
    (`ai4news.rnd.huawei.com`) and news users still enter through it; auth cookies are HOST-scoped
    while `AUTH_URL` pins the OAuth callback to `cari` — a login started on the alias writes its
    state cookie into the wrong jar and the callback finds nothing (in @auth/core 0.37.2 a
    *missing* state cookie throws this same "could not be parsed" message). Three shipped
    defenses, keep all: (a) nginx 301s non-cari hosts inside both `/ai-community` locations
    (deploy conf); (b) the root layout's `canonicalRedirectTarget` backstop (lib/auth/cookies.ts —
    SSO deploys only, loopback/IP exempt); (c) cookies are app-scoped `aic.*` names path-limited to
    the basePath (`buildAuthCookies`) so no epoch/app/alias residue accidentally shadows them — cookie NAMES
    are also the JWT salt, so renaming them logs everyone out once (expected). `pages.signIn`/
    `pages.error` are used VERBATIM by @auth/core (no basePath prefixing) — they must carry
    `NEXT_PUBLIC_BASE_PATH`; `/auth/error` shows the error code + developer contact, and the login
    page only maps `CredentialsSignin` to 邮箱或密码错误 (other codes get the SSO banner).
    TOPOLOGY (owner decision 2026-08): the two hostnames are SEPARATE SITES — news keeps
    ai4news.rnd.huawei.com untouched, ai-community answers ONLY on cari. Never mount the
    /ai-community locations under the news server_name; the per-location `if` guards + layout
    backstop enforce the split even on a shared block. Do NOT change news config for this
    (docs/huawei-sso-deploy.md "Domain separation").

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
  `/api/shorts/upload` (raw-body protocol; **NO limits by product decision** — no size cap, no
  duration cap, no daily byte budget, no per-day publish cap; only a 30/min burst limiter. Do NOT
  reintroduce caps. `sizeBytes` clamps at int32 max; faststart remux, skipped >2GB as a perf guard);
  publish = POST `/api/shorts` re-validating echoed keys (shape + on-disk + not-attached-elsewhere);
  ffprobe only CORRECTS durationSec metadata (client value is the fallback). Views count ONLY via the
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
  `lib/video/subtitles-shared.ts` (unit-testable, no env). **Cues are rendered by US, not the
  browser**: tracks run in `hidden` mode (cuechange still fires) and the active cue is drawn as an
  overlay INSIDE the visible frame just above the caption — native `::cue` paints at the bottom of
  the video ELEMENT (its letterbox), which on a tall cell lands at the page bottom. Selector
  cycles 关→中→EN, persisted `shorts:subtitle`.
  **内容来源** (migration `20260813150000_add_short_origin`): `originType original|repost` +
  `sourceUrl/sourceAuthor` — 搬运 REQUIRES both (server 400 `source_required`); shown in the cell
  meta + the 详情 panel. **Feed desktop layout is 抖音-style**: left swipe feed + right
  `ShortsSidePanel` (详情 | 评论 | TA 的作品 tabs, follows the active item; comments = the same
  CommentSection; works = `ShortsAuthorWorks`, fed by `GET /api/shorts?uploader=<handle>`). ALL
  shorts overlays (评论 sheet/panel, TA 的作品) ride the shared `HostPanel` shell: **transparent
  click-catcher, NO scrim** (a black/40 scrim grayed the video — user rejected it), sliding from
  INSIDE the player container; hosts wrap conditional renders in `<AnimatePresence>` for the exit
  slide. **Embedded players (ShortsShowcase) go further: the panel is INLINE** — root is a flex
  row, the panel animates width 0%→62% (max 400px) and the video region RESIZES to make room
  (covering the video was rejected); the widget's wheel handler must ignore events inside
  `[data-shorts-panel]` or the comment list can't scroll. Embed fullscreen adds
  `h-[100dvh] w-screen` when active (Tailwind's fixed-height class otherwise beats the UA
  :fullscreen sizing and the video stays small). 评论 composer (`CommentComposer`, shared with the
  long-video detail page) is 抖音-lightweight BY DEFAULT: auto-growing textarea pill (Enter 发送)
  + 图片/表情包 buttons appending markdown + a small round icon send button; the full
  RichTextEditor sits behind an explicit 富文本 toggle — do not make rich the default again.
  Comment likes already exist (`VideoCommentLike` + ♡ in CommentItem). Avatar click opens TA 的作品 (NOT the profile — profile link lives in the panel header);
  subtitle cue renders INSIDE the caption gradient container above the text block so it rides up
  with the caption and can never overlap it. Embed fullscreen is a TOGGLE tracked via
  `fullscreenchange` (wheel/touch listeners live on the fullscreened element, so 上下刷 works in
  fullscreen; ↑/↓/M added while fullscreen). Nav renames:
  Skills Center→Skills, Geek Hub→Videos. **`/videos` DEFAULTS to Geek Videos** (2026-08-26 — the
  section is named after the long-form board, so that is what a visitor lands on); Shorts is the
  second tab at `?tab=shorts`, and the immersive feed stays at `/videos/shorts` (its back arrow
  returns to `?tab=shorts`). Bare `/videos` therefore carries NO `tab` param — pagination and
  breadcrumbs must not add one. The switcher keeps `mb-6` above the billboard; without it the two
  read as one welded block. Shorts CTAs are NEUTRAL (zinc/white
  solids) — the user explicitly rejected accent-blue "AI-looking" buttons; homepage shorts header
  has view-all ONLY (no upload button).
- **评论点赞是一条统一契约 (2026-08-27).** Every comment/reply surface in the app now has likes:
  video, 动态, 技术专区 and 共享批注 already did; migration `20260827160000_comment_likes` adds
  `FeedbackCommentLike` / `DiscussionReplyLike` / `LibraryCommentLike` / `LibraryNoteReplyLike` /
  `VoteCommentLike` plus a `likeCount` column on each parent. Three rules, all load-bearing:
  - **The route shape is fixed**: guarded writes in ONE transaction (`deleteMany` → decrement, else
    `createMany({skipDuplicates})` → increment) followed by an AUTHORITATIVE re-read of both the
    counter and the viewer's own row. A racing double-click must be a no-op, never a P2002 500, and
    the counter must never drift from the join table. Copy `app/api/zones/comments/[id]/like`.
  - **The gate mirrors the surface's own LIST route** — a comment is likeable exactly when it is
    readable. 作品评论 on a hidden/unapproved entry stay manager-only; a 批注 reply is likeable only
    while its annotation is shared; every route re-checks that the comment belongs to the parent in
    the URL so an id from another thread cannot be liked through it.
  - **The button is `components/CommentLikeButton.tsx`**, not a new copy. It owns optimistic paint →
    server reconcile → rollback, the signed-out login redirect, and the single-flight guard. `tone`
    exists because three palettes are in play: `default` (zinc), `reader` (the 知识库 reader follows
    its OWN 浅色/护眼/深色 theme, so `dark:` variants are wrong there half the time) and `onDark`
    (the 投票 lightbox is dark whatever the site theme, so `dark:` never fires). The video, 动态 and
    技术专区 components still carry their own inline copy of the handler — new threads must use the
    shared button, and those three should migrate onto it when next touched.
  - `likedByMe` is resolved with ONE batched read per page of comments (a `likes: { where }` per row
    is a correlated subquery per comment, and these threads cap at 300+100).
- **管理身份不出现在成员界面 (2026-08-27).** `publicRoleBadge` (`lib/permissions.ts`) is the ONLY
  way a role name reaches a member-facing payload. It drops `member` AND every staff role — where
  "staff" is `isStaff`, i.e. carries at least one permission — so 超级管理员/管理员 never appear on
  a profile, a 用户卡片 or an annotation byline. An HONORIFIC role survives on purpose: a 专家 role
  created with an EMPTY permission list still badges, which is what the 共享批注 feature was built
  around. The trim happens at the SERVER boundary (`/api/users/[handle]/card`,
  `/api/library/docs/[id]/notes`), never as a client-side hide, and the role's `permissions` must be
  in the select for it to work. The staff's own 管理后台 link in `UserMenu` is unaffected — that is
  the operator seeing their own tools, not a badge shown to others.
- **导航栏 (2026-08-27) is measured, not guessed.** `components/nav-items.ts` is the destination
  catalog; `components/nav-overflow.tsx` renders it. The row is `flex-1 min-w-0 overflow-hidden`
  between a `shrink-0` logo and a `shrink-0` action cluster, so its `clientWidth` IS the budget: it
  caches each link's natural width (after `document.fonts.ready` — a fallback-font pass measures
  wrong) and keeps only what fits, handing the rest to the overflow menu through a context the
  header wraps. **Never add a nav link by hand to the header** and never re-introduce a fixed
  `hidden md:flex` list — that is exactly what ran "Docs" under the search box in English and left
  phones with no navigation at all. 中文 fits 6 inline at 1440, en fits 6, fr fits 5, a phone fits
  0; nothing is clipped in any of them because the row measures instead of assuming.
  `PRIMARY_NAV` competes for the row; `STASHED_NAV` (投票 / 文档 / 意见反馈) is always in the menu.
- **收纳菜单 `components/NavMoreMenu.tsx`** is the React Bits `<BubbleMenu />` *motion* on
  framer-motion — deliberately NOT the component: the original is a GSAP full-viewport takeover
  with 4rem rotated pills, which would have added a second animation library to animate three
  utility links on a 56px bar. Kept: `back.out(1.5)`-shaped overshoot (`BACK_OUT` cubic-bezier),
  per-item stagger, labels sliding up a beat behind their bubble, the two-line toggle morphing
  into an X. Changed: the ±8° tilt is the ENTRANCE only and settles to 0 (a permanent tilt reads
  as sloppy alignment in a 9-row stack at 13px), and the pills are ink — hover fills with
  `zinc-900`/`zinc-100` rather than the original's per-item hue, per the 配色契约. The panel is
  PORTALED via `useAnchoredPanel` because `NavBarShell`'s `transition-transform` makes it a
  containing block for `position: fixed`.
- **配色契约 (2026-08-26): ink chrome, colourful content.** ONE rule decides every colour
  question in this app: *the page has no colour of its own; colour belongs to the material.*
  - **Chrome is ink.** Primary buttons, toggles, active tabs/pills, progress bars, focus rings,
    sliders, selection — all `zinc-900` in light / `zinc-100` in dark (`--accent` in
    `app/globals.css` is now a PER-THEME ink token, not indigo, so a focus ring stays visible on
    both grounds). There is **no `accent-*` class left in `app/**` or `components/**`**; the ramp
    survives in `tailwind.config.ts` only as a fallback for stray future code. The indigo
    `bg-accent-500` button was what the user called "ai 风很浓" — do not bring it back, and do not
    invent a new brand hue for buttons. The only saturated pixel the chrome owns is the CARI logo.
  - **Content keeps its real colour.** Book spines (`DocCover` — hashed hue, no grayscale variant,
    the `mono` prop is GONE), GitHub's per-language dot + the gold star (`GithubTrending`), skill
    source/visibility pills (`SourceBadge` blue/emerald/violet, `VisibilityBadge` emerald/amber/
    zinc), the token-cost threshold (`TokenCostBadge` — ink until it is actually expensive), rating
    stars (`StatRow`, amber), forum categories (`app/discussion/_components/badges.tsx`), event
    kinds (`app/events/_components/badges.tsx`), the notification badge (red), video frames, and
    **people** — `Avatar`'s fallback badge is a name-hashed colour from a 12-hue identity palette
    (`identityColor`, exported), which is why the `tone` prop was deleted from the component and
    from ~37 call sites. Greying these out is what the user rejected as "强行弄成了黑白".
  - Taxonomy chips take their class from the board that OWNS the taxonomy (the homepage imports
    `CATEGORY_META`/`KIND_META`) so a category looks the same on the homepage as on the page the
    row links to. Never re-invent a per-domain palette at the call site.
  - The 知识库 reader is the one surface with its own accent: `--reader-accent` /
    `--reader-accent-rgb` in `read/reader.css` (a deep book-blue, lifted for the dark page) drive
    in-article links, blockquote rules, prose selection and citation chips. They follow the READER
    theme, never the site's — a wall of ink is the wrong answer for a reading surface.
- **首页 (signed-in home)**: `app/_components/CommunityHome.tsx`. Band order is
  hero (greeting + 今日 figures, **GitHub 热榜**, shorts player) → 社区此刻 → 热门 Skills → 热门视频;
  热门 Skills deliberately sits BELOW 社区此刻 (it used to own the hero-left slot the 热榜 now has).
  It follows the 配色契约 above: ink chrome, and the material (spines, language dots, category
  chips, avatars, video frames) in colour. Do not reintroduce tinted icon chips
  (`bg-accent-500/15` + icon), accent link colours or blurred colour glows — that combination is
  what the user rejected as "太 AI" — and do NOT grey the content out again either, which is what
  the user rejected next. `HeroBackdrop` is colourless (hairline grid + neutral overhead light +
  an inlined feTurbulence grain tile; the light-mode gradient MUST keep its `dark:hidden` or it
  washes out the dark hero). `SectionHeader` closes with a hairline rule instead of a chip. The
  hero brief lines carry the source's own dot (event kind / amber for 公告) and the empty shorts
  slot carries an upload CTA rather than 520px of void. **No `contain: paint` on the hero
  section** — paint containment makes it a containing block for `position: fixed` descendants,
  the same trap as `card-hover`'s transform. `SkillCard` titles are `line-clamp-2`, never
  `truncate` (a one-line clamp cut real names in half at every grid width under four columns).
- **GitHub 热榜**: `lib/github-trending-shared.ts` is the pure, unit-tested half (types +
  `parseTrendingHtml`, dependency-free regex — one trending page is ~650 KB and gets re-parsed on
  every cache miss, so no jsdom; it drops `<svg>` blocks WHOLE before tag-stripping because the
  path `d` attributes are full of digits that would otherwise be parsed as the star count).
  `lib/github-trending.ts` is server-only: `egressFetch` (github.com is EXTERNAL, so it tunnels
  through the corporate proxy on the intranet), a per-period module cache, in-flight dedupe, a
  2 MB body cap, and a 60 s failure backoff — without that backoff an unreachable github.com would
  fire a fresh 15 s request on every homepage render. **Refresh cadence is `GITHUB_TRENDING_TTL_HOURS`,
  default 12** (≈2 upstream hits/day/window, 6 across all three; trending itself only moves daily,
  so a short TTL buys nothing and just spends the outbound budget). Past the TTL the cached list is
  still served INSTANTLY while a refresh runs behind it; a request only waits on github.com again
  past `max(24 h, 2 × TTL)`, so raising the TTL can never put a blocking fetch back on the
  homepage's critical path. The RSC calls
  `getTrendingWithin('daily', 1500)` (the homepage is `force-dynamic`, so a cold cache must NOT
  block the render; past the budget it returns null and the client leaf fetches from
  `/api/github-trending`) plus `warmTrending()` for the other two windows. `GITHUB_TOKEN` is
  optional and only unlocks REST enrichment (topics/license/issues) — unauthenticated is 60
  req/hour and one full refresh costs up to 75, so it is skipped entirely when unset and the row
  must look complete without it. Contributor avatars are deliberately NOT rendered: the intranet
  cannot reach `avatars.githubusercontent.com`. i18n namespace `github_trending`; star/fork totals
  are formatted `en-US` on purpose so a 中文 viewer sees `12.4k` like github.com, not `1.2万`.
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
  评论: EntryComments). Gallery renders WINDOWED (GRID_PAGE=48 + IntersectionObserver
  sentinel — DOM count, not payload, is the load concern) and offers a 榜单 list view when
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
    时才挂载**（画廊的渲染窗口只增不减，滚到底会有上千张卡，常驻媒体元素毫无意义）、
    模块级 `activePreview` 保证全站同一时刻只有一张卡在播、以及 `pause()+removeAttribute('src')+load()`
    的硬卸载。删掉其中任何一件，闸门就不成立了。
  - **浏览数只给发起人/管理员**。`VoteEntry.viewCount` + `VoteEntryVisit`（sessionHash 按
    (viewer, entry, **UTC** 日) 去重 —— 注意这和投票预算的 `voteDayKey` 北京时间日桶是两回事）。
    打开灯箱触发 `POST /api/votes/[id]/entries/[entryId]/view`，计数闸门与阅读闸门一致
    （草稿活动 / hidden / 非 approved 一律 404，且校验作品属于 URL 里的活动）。
    `toVoteEntryView` 按 `isOwner` 裁成 `viewCount: number | null`，和 `voteCount` 同一套家法：
    **服务端裁剪，绝不发了再前端隐藏**。路由回 `{counted}`，客户端只在真记上时才就地 +1
    （去重命中时不动，否则发起人会看到数据库里没有的数字）。发起人自己的打开**不计数**
    （`counted:false, reason:'self'`）—— 这个数字是给他读的，把他自己逐件审稿的痕迹算进去
    就没法看了。前端的计数 effect **必须带停留延迟**（`VIEW_DWELL_MS`）：它的触发单位是
    `lightboxId` 变化，而 ←/→ 正是改这个 id，不 debounce 的话按住方向键就是每秒 ~30 个
    POST，既打爆 240/min 限流，也会给一堆只掠过 300ms 的作品记上浏览。
  - **另外**：`GET /api/votes/[id]` 以前**匿名可读**，而这个 payload 在 实名展示（默认开）
    下带着 作品名/作者名/**工号** —— `/votes` 的页面有 layout 登录墙，这条路由却没有，等于
    绕过墙拿一份工号名册（`/api/search` 同样匿名，能从关键词直接搜到活动 id，链路是通的）。
    现在补了 401。前端唯一的调用方在登录墙里面，没有匿名消费者。
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
    while someone is mid-sentence), `PostContextStrip` (`top-[var(--nav-offset)]`), `ReadProgress` hairline,
    `useLikeBookmark` shared by the action bar and the strip, `BodyImageLightbox` (ONE delegated click on
    `ZoneMarkdown`; stickers by RAW src prefix, linked images and embed thumbnails are skipped).
  - **Motion grammar** = `lib/motion.ts` `TWEEN_FAST` / `TWEEN` / `TWEEN_PANE` (+ the used-for / never-for table
    there); the whole budget is the M1–M27 table in the redesign spec — titles, prose, avatars, first-paint
    counts, route changes, menus, typing and page appends never animate. `DockShell` and `DrawerShell` are
    deliberately two components (non-modal vs modal). i18n prefixes added this round: `panel_*`, `columns_*`,
    `home_*`, `column_rail_*`, `column_band_*`, `notice_*`, `rules_*`, `mods_*`, `onboard_*`, `composer_*`
    (new), `attach_*` (new), `post_*` (new), `rail_strip_*`, `strip_aria`, `ui.rte_table_*`, `ui.rte_upload_file`.
- **员工名单 (Employee Directory)**: admin roster at `/manage/employees` (`EmployeeDirectory` model;
  bulk import via paste / CSV / XLSX — parsers in `lib/employee-import.ts`, merge rules in
  `lib/employee-admin.ts`; 工号 canonicalized to lowercase at write time — the DB unique index is
  case-sensitive, app lookups are not). Rows with 工号 push `User.department`/`lab` onto matching
  users on every create/update/import, via the manual 同步 button, AND at login (`signIn` callback,
  best-effort). Match = `huaweiW3Id` ONLY (`lib/employee-directory.ts`) — NEVER
  the handle: it derives from the unverified email local part under open registration, so matching
  it would let `<工号>@any.tld` squatters inherit an employee's 部门/研究所 and harvest the roster.
  **Matching is by DIGIT RUN** (`accountMatchKey`, 2026-08-25): rosters carry the W3 account
  (`z84412632` — surname initial + number) while the SSO `uid` stored in `huaweiW3Id` is the bare
  number (`84412632`), so a literal compare never matched anyone. Keys are compared as strings
  (leading zeros significant, `00412632` ≠ `412632`); a digit-less value keys on its text. The
  stored spelling keeps its letter prefix but is written through `canonicalAccountText` (NFKC —
  fullwidth `ｚ８４４１２６３２` → `z84412632` — whitespace dropped, lowercased) because Prisma
  can't express "digits of column": EVERY lookup is a `contains`/insensitive-`equals` PRE-FILTER +
  exact `accountMatchKey` re-check in app code (`findDirectoryEntries`, `linkedAccountKeys`,
  `buildUserAccountIndex`), and the prefilter only works when the stored digit run is ASCII and
  contiguous — never trust the prefilter alone, never store an un-canonicalized 工号, and never add a
  new literal `huaweiW3Id`/`accountNumber` equality (`/manage/users` search ORs in the key too).
  Import and 全量同步 build ONE user index up front (import refreshes it every 5 s so a first SSO
  login mid-import is still caught) so roster rows with no registered user cost no write; the import
  additionally loads the WHOLE roster into a `DirectoryIndex` once (lib/employee-match.ts) instead of
  querying per row, and keeps it in sync as it creates/updates/merges. Legacy
  duplicates (`84412632` + `z84412632`) resolve MOST-RECENTLY-UPDATED on every path (login-time
  sync takes `findDirectoryEntries()[0]`, 全量同步 writes oldest→newest so the same row wins — keep
  them in agreement or a user's department flip-flops); admin create/update treat a same-key row as
  `account_exists`.
  Deleting an entry never touches users; 停用 (isActive=false) entries are excluded from all sync.
  **Re-uploading a roster OVERWRITES, it does not duplicate** (`lib/employee-match.ts`,
  `resolveImportTarget`, 2026-08-26). The original roster was imported with no 工号 at all, so a
  re-upload carrying 工号 matched nothing and created a second row per person. Order now:
  (1) 工号 digit key — the only identity trusted outright, and it WINS over 姓名 (a hit is renamed
  to the file's spelling); (2) 姓名 (`canonicalPersonName` = same NFKC/whitespace/case folding as
  工号) among rows that have NO 工号 — the pre-工号 rows — narrowed by 部门 then 研究所, and the
  file's 工号 is BACKFILLED onto the row it matches; (3) for a file row with no 工号, the single row
  with that name, whose 工号 is left untouched. Rule 2 only ever looks at account-less rows, so a
  name can never steal a 工号 another row already owns. Anything still ambiguous is REFUSED, never
  guessed: a row with a 工号 is created + warned ("请人工核对合并"), one without is skipped + warned;
  both land in `warnings` (shown in the panel, kept in the audit log). Field rules: non-empty values
  always overwrite (that IS the 覆盖), blanks only clear under the `clearMissing` option, 工号 is
  never cleared and never rewritten to a different one, and 停用 rows are updated but never
  re-activated by an import (use 批量启用). `mergeNameDuplicates` is the opt-in, destructive cleanup
  for damage from before this rule existed: once a matched row carries a 工号 it DELETES same-name
  account-less rows — but ONLY those `classifyNameDuplicates` finds non-contradictory (部门/研究所
  blank, or equal to the import row's or the kept row's before/after value). **A plain
  `filter(!accountNumber)` there was a confirmed data-loss bug**: 王伟/z84412632/无线 plus a legacy
  王伟//终端 (a different person) meant re-uploading the 无线 list deleted the 终端 王伟, even on an
  import that changed nothing — and `narrow()` had often just used 部门 to decide those two rows are
  different people, so the merge was breaking this module's own "never guess" rule while
  `resolveImportTarget` refuses to even UPDATE a row it can't disambiguate. Contradicting rows are
  reported, never deleted, and every actual deletion is listed row-by-row in `mergedRows` (response,
  panel and audit log) — a hard delete behind an aggregate count is unauditable and unrecoverable.
  Counters (`added/updated/unchanged/backfilledAccounts/mergedDuplicates/skipped`) are pinned by
  `tests/employee-import-merge.test.ts` (in-memory DB) + `tests/employee-match.test.ts` (pure).
  **Bulk ops**: `/api/admin/employees/bulk` (删除/停用/启用) takes EITHER `ids` OR
  `{all:true, filter}` (exactly one — a body carrying both is rejected, since "silently prefer
  `all`" on a full-table-delete endpoint is how accidents happen); the filter path re-runs
  `employeeWhere()` from `lib/employee-queries.ts` — the SAME function the page uses — so
  「选择全部 N 条」 acts on exactly the set that filter renders (other PAGES of it included, which is
  the point) and never on a set the two could disagree about. Keep that single source; a second copy
  of the `where` would drift and delete rows the admin never saw. 启用 re-pushes
  部门/研究所 to users (停用 rows were skipped while disabled), 停用/删除 never touch users. The
  `?dup=1` 仅看重名 filter is a cleanup aid over the RAW stored name (a `groupBy`), deliberately not
  the canonical matching key.
- **角色与权限 (RBAC, migration `20260824180000_add_roles`)**: `User.isAdmin` is no longer a
  decision — it is a DERIVED "staff" cache (any permission at all) written only by `lib/roles.ts`.
  Truth = `Role` (`key`, `permissions String[]`) + `User.roleId` (null ⇒ 普通成员). The catalog is
  CODE: `lib/permissions.ts` (import-free, client-safe) — 17 keys, one per 管理后台 section
  (`dashboard users employees skills packs videos shorts discussion votes library categories
  announcements logs`) plus site-only `feedback events polls` and `identity` (see 隐私账号 below).
  Adding a domain = one catalog entry + granting it to roles in 管理后台 → 角色与权限 (the seeded
  `admin` role gets every key at migration time only; later keys are granted explicitly).
  `super_admin` is decided by ROLE KEY (its list is `['*']`) and is the ONLY role that can open
  /manage/roles, create/edit/delete roles, or assign roles (`POST /api/admin/users/[id]/role`);
  rules in `lib/roles.ts#assignRole`: never your own account, last active super admin can't be
  demoted, Serializable tx. `/api/admin/users/[id]/toggle` refuses `isAdmin`, refuses staff targets
  for non-super actors, self-disable, and disabling the last super admin. Decide with
  `can(session.user, '<domain>')` (JWT copy: `session.user.roleKey/permissions`, refreshed on
  sign-in, `useSession().update()`, and every 60 s — `ROLE_CLAIMS_TTL_MS`) or, for /manage pages and
  /api/admin routes, `requirePermission` / `gateApi` (DB-backed). CLI PATs resolve the role too
  (`lib/auth/either.ts`), so `can(actor, 'skills')` works for the CLI. lib query helpers take a
  `DomainViewer { id, canManage, canSeeIdentity }` (`domainViewer(session?.user, 'votes')`,
  `eventViewerFromSession`, `libraryViewerFromSession`, `videoActorFrom`) — `canManage` is the
  domain key, `canSeeIdentity` is `identity`, and they are deliberately orthogonal. **JWT freshness
  depends on the SessionProvider poll** (`components/AuthProvider.tsx` `refetchInterval={60}`):
  next-auth's bare `auth()` discards the refreshed cookie, only `/api/auth/session` re-signs it, so
  the poll (< `ROLE_CLAIMS_TTL_MS` = 90 s) is what keeps bare `auth()` free of DB reads — don't
  remove it. `User.roleId` is `onDelete: Restrict` on purpose (a vanished role must never leave a
  role-less `isAdmin` row, which `roleForUserRow` reads as a legacy super admin). Video and
  short share the table, so `canManageVideo`/`canModerateComment` branch on `video.isShort`
  (`videos` vs `shorts`). Client viewer props are named `canModerate` and computed PER SURFACE by
  the RSC (never shipped as a raw staff flag). Only three surfaces still read `isAdmin`: the
  UserMenu 管理后台 link, `/api/auth/me`, and the SUBJECT's badge on `/users/[handle]`.
  Transitional safety net: `roleForUserRow` treats `isAdmin=true` with NO role as a legacy super
  admin (the same promotion the migration does), so a `prisma db push` deploy that skipped the
  migration's UPDATE does not lock every admin out; `pnpm roles:sync` (`scripts/sync-roles.ts`)
  makes it explicit and recomputes the cache. Tests: `tests/permissions.test.ts`,
  `tests/roles.test.ts` (pins `scripts/seed.ts`'s admin list to the catalog).
- **页面访问 (PageVisit)**: `lib/page-visit.ts` names EVERY `app/**/page.tsx` route and
  `tests/page-visit.test.ts` enforces it in BOTH directions (a new page without a name, or a stale
  entry, fails the suite); unknown paths are still logged (pageName null ⇒ the UI shows the raw
  path), so nothing silently drops out of a user's history again. Staff viewers' visits to
  user-specific pages (`USER_SPECIFIC_TEMPLATES`: `/users/[handle]`, `/manage/users/[id]`) are
  REDACTED to the route template at write time (`redactUserSpecificPath`, keyed on the JWT
  `isAdmin`) and masked at display time for legacy rows (`displayVisitPath`) — the activity is
  kept, WHO they looked at is not. Query strings never reach the store (`normalizePath`), and the
  `referrer` column goes through `sanitizeReferrer` (the tracker fires from the visited page, so the
  raw header is that page's full URL — storing it raw would re-leak the redacted path). The roles
  migration ALSO rewrites existing staff rows (path → template, referrer → NULL); `pnpm roles:sync`
  repeats that data step for `db push` deploys.
- **用户卡片 (hover card)**: `components/user/UserHoverCard.tsx` — hover any person and a
  profile card (banner/avatar/角色/@handle/DeptTag/签名/标签/counts) fades in from
  `GET /api/users/[handle]/card`. It is wired app-wide through `Avatar`: **pass `handle` to
  `<Avatar/>` and it self-wraps** — that is the one thing to remember when adding a new surface
  that renders another user. Omit `handle` ONLY for the viewer's own avatar (navbar, composers,
  settings) and for non-users (`EventSpeaker` rows are free text). Three invariants, each of
  which was a real bug: the popover is **portaled to body** (an ancestor `opacity` renders it
  translucent with the page bleeding through; an ancestor `transform` re-parents its `fixed`
  box — same trap as `DeptTag`'s tooltip and `ImageLightbox`); nesting is **self-suppressing**
  via context, so a call site may still wrap an avatar+name cluster in `<UserHoverCard>` to make
  the NAME hoverable without stacking two cards on the avatar inside; and a null/401 fetch
  **closes** rather than leaving a skeleton (the endpoint needs a session, so anonymous visitors
  get no card). One fetch per handle per page (module-level cache) on 150 ms hover intent.
  标签 (`UserTag`/`UserTagAssignment`): admin-assigned in bulk or singly at `/manage/user-tags`,
  auto-granted ones (版主) synced by `lib/user-tags.ts`, and the user picks which to display at
  `/settings/tags`.
- **隐私账号 & identity display**: `User.isPrivate` toggle at Settings → 隐私. Contract
  (`lib/user-identity.ts`): author queries select `AUTHOR_IDENTITY_SELECT` and every server
  boundary (RSC props / API JSON) maps through `toPublicAuthor(author, can(user, 'identity'))` so a
  private user's department/lab are stripped SERVER-side (never shipped-then-hidden); UI renders
  `<DeptTag/>` (`components/DeptTag.tsx`) next to names and hides the `@handle` TEXT when
  `isPrivate` (profile links keep working; handle stays in payloads for ownership checks).
  `DeptTag` is a CLIENT component capped at `max-w-[12rem] min-w-0` (a full org path used to
  dominate every comment/post author row; a plain length, NOT `min(100%,…)` — cyclic percentages
  inside shrink-wrapped flex items size the row to the untruncated text) with the whole text in a
  hover/tap tooltip that is PORTALED to `<body>` (or the fullscreen element) as `position: fixed
  w-max` (auto width would shrink-fit into `viewport − left` near the right edge) — author rows
  sit inside `overflow-hidden` cards and `card-hover` transforms that would clip an in-flow
  tooltip — measured then flipped below the pill when there is no room above, and shown only
  when text is actually ellipsized (touch: tap toggles; the post-tap `pointerleave` is ignored).
  Pass `full` on identity headers (profile page: no cap, wraps instead of truncating); don't
  reintroduce a bare `title=` (double tooltip) or an in-flow absolute bubble. A card whose whole
  surface is a stretched `<Link className="absolute inset-0">` overlay must give the pill
  `relative z-[1]` (EventCard does) or the tooltip can never open there.
  Full identity is unlocked by the `identity` PERMISSION only — a domain permission such as
  `discussion` does NOT imply it (the 隐私 badge in /manage reads the raw row). Any NEW surface
  that renders another user's identity must follow this select → trim → DeptTag pattern.
- **Video delivery**: the file route (`app/api/videos/file/[...key]`) streams from local disk with
  HTTP Range. Under concurrency the bottleneck is that bytes flow through Node — set
  `VIDEO_X_ACCEL_REDIRECT=true` + add the internal `/_video/` nginx location (see deploy conf)
  to offload byte-serving to nginx `sendfile` (Node only does `auth()` then returns the header).
  Card/hero hover previews use ONLY the dedicated short `preview` clip (never the full source) —
  don't reintroduce a `?? videoUrl` fallback. (The 投票活动 gallery has a deliberately gated
  exception — see 作品卡片 = Geek Videos 卡片 above — and unlike this board it GENERATES its clips
  server-side; `Video.previewKey` here is still a second file an admin uploads by hand.) Not yet done (needs ffmpeg on the box): `+faststart`
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
- **i18n (中/EN/FR) — no hardcoded UI strings**: every user-visible string lives in
  `messages/{zh-CN,en,fr}.json` (zh-CN is the source of truth; all three files must stay at
  **key parity** — the merge script in the i18n work checks this, and a missing key renders the
  raw key path in prod). Read via `useTranslations('<ns>')` (client) / `await getTranslations('<ns>')`
  (server RSC); the locale comes from the `locale` cookie with Accept-Language as the
  first-visit default (`i18n/request.ts`). The cookie is written by TWO surfaces —
  `components/LanguageSwitcher.tsx` (navbar, left of the avatar; the discoverable one) and
  设置 → 语言 — both through `lib/locales.ts`, which is the import-free single source of the
  locale list (`LOCALE_OPTIONS`/`SUPPORTED_LOCALES`, re-exported by `i18n/request.ts`) so a new
  language is added in ONE place. Rules that cost real time:
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
