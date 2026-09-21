# 平台基础设施与全站约定

> 从 CLAUDE.md 拆出：出口代理、LLM、邮件、通知、迁移、评论点赞、i18n、演示数据。

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
- **演示内容 (`pnpm demo:seed` / `demo:unseed` / `--dry-run`)**: `scripts/demo-content.ts` — a
  pull-and-go demo dataset for the owner's migration (「迁移时无法放进数据库，希望 pull 下就有、
  之后好删」). Two 温哥华 版块 with rich posts (cross-zone `[embed:]`, polls, tables, office
  attachments, comments/likes) + 15 活动 spanning past/live/future, all four kinds and timezones.
  **The removal boundary is NAMED, never prefix-guessed**: two zone slugs, 15 hard-coded
  `demo-evt-…` ids, five `@demo.invalid` accounts. Events have no slug, which is exactly why their
  ids are written down — unseed does an explicit `deleteMany`, it does NOT rely on cascade from
  deleting the accounts. `assertEventBoundary()` runs in the FIRST second of seed (before the
  silent unseed) and exits if the boundary and the content table stop covering each other, so an
  unregistered row can never be installed and then be un-deletable. Seed is idempotent by
  unseeding first. Two knowing side effects, both documented in the file: the real owner account
  joins 3 demo events (so 「我参加的」 isn't empty) and goes away with them, and attendee rows are
  written with `remindedAt` pre-set so the reminder sweep can never mail anyone about demo data.
  Assets (covers, avatars, figures, PDF/PPTX/XLSX) are generated by `scripts/demo/make-assets.py`
  and COMMITTED, so a fresh clone can seed with no network. Times go through `zonedWallToUtc` like
  every other Event writer — never `new Date('…T10:00')`. Teardown is proven by counting 21 tables
  and both storage roots (`zone-media`, `uploads/images`) before/after/after-removal.
- **Skill upload has exactly ONE entry**: the 上传 Skill button on `/skills` (Skills Center).
  It was removed from the user menu on purpose — the avatar dropdown is navigation to *your own*
  surfaces (主页 / 书架 / 设置 — 面板 merged into 主页's 工作台 tab), not an authoring action.
