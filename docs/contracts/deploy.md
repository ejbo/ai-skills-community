# 部署与子路径 (deploy, basePath, nginx, SSO cookie)

> 从 CLAUDE.md 拆出。每条都真实花过时间，部署前通读。

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


## Pitfalls

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
