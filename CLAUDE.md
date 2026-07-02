# CLAUDE.md — skills-community (AI Community)

Next.js 14 (App Router) + NextAuth/Auth.js v5 + Prisma (PostgreSQL) + pnpm.
Two deploys: **external** (AWS, root path, email/password only) and **internal**
(Huawei intranet, served under `/ai-community` on `ai4news.rnd.huawei.com`, adds Huawei
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

systemd (production): `deploy/ai-community.service` is preset for this box (`WorkingDirectory=/opt/cari_projects/ai-skills-community`, `User=ai4news`, `NEXT_BASE_PATH=/ai-community`). `sudo cp` it, set `ExecStart`'s node to your `which node` (absolute — systemd ignores your nvm/conda PATH), `daemon-reload`, `enable --now`. After `git pull` on the server: `NEXT_BASE_PATH=/ai-community pnpm build && sudo systemctl restart ai-community`.

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
   - `.env`: `AUTH_URL=https://ai4news.rnd.huawei.com/ai-community/api/auth` (must end `/api/auth`);
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
  (except `NEXT_PUBLIC_*`, which are build-time inlined).
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
- **Video delivery**: the file route (`app/api/videos/file/[...key]`) streams from local disk with
  HTTP Range. Under concurrency the bottleneck is that bytes flow through Node — set
  `VIDEO_X_ACCEL_REDIRECT=true` + add the internal `/_video/` nginx location (see deploy conf)
  to offload byte-serving to nginx `sendfile` (Node only does `auth()` then returns the header).
  Card/hero hover previews use ONLY the dedicated short `preview` clip (never the full source) —
  don't reintroduce a `?? videoUrl` fallback. Not yet done (needs ffmpeg on the box): `+faststart`
  remux on upload (fixes tail-`moov` first-frame delay) and HLS/adaptive transcoding.
