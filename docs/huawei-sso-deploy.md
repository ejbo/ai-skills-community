# Huawei W3 / UniPortal (IDaaS) SSO — deployment guide

How to turn on Huawei W3 login for this app in the internal environment. The **code**
is already done and subpath-agnostic; this guide is the **config** you apply at deploy.

Replace `<SUBPATH>` below with the path you mount the app under (e.g. `community`).
Everything must use the **same** `<SUBPATH>`: `NEXT_BASE_PATH`, `AUTH_URL`, the nginx
`location`, and the redirect_uri you register with Huawei.

---

## ⭐ This rollout (locked): `/ai-community` on `cari.rnd.huawei.com`

Concrete values for the current internal deploy — **D2 (reuse an existing `client_id`),
direct egress**. Domain migrated from `ai4news.rnd.huawei.com` in 2026-07; the new host
is registered (备案) in IDaaS. Ready-to-use artifacts:
[`../.env.ai-community.example`](../.env.ai-community.example) and
[`../deploy/ai-community.nginx.conf`](../deploy/ai-community.nginx.conf).

| Setting | Value |
|---|---|
| Host (正统域名) | `cari.rnd.huawei.com` (was `ai4news.rnd.huawei.com` until 2026-07) |
| Subpath | `/ai-community` |
| `AUTH_URL` | `https://cari.rnd.huawei.com/ai-community/api/auth` ⚠️ must include `/api/auth` |
| `NEXT_BASE_PATH` | `/ai-community` |
| Callback to register/confirm | `https://cari.rnd.huawei.com/ai-community/api/auth/callback/huawei` |
| `client_id` / `secret` | the registration whose 应用域名 covers `cari.rnd.huawei.com` (D2) |
| `USE_PROXY` | `true` for public-internet features; uniportal still goes **direct** via the bypass list. `SSO_VERIFY_SSL=false` |
| App upstream port | `127.0.0.1:3100` (any free port; must match nginx + the `next start -p`) |

**Steps**

1. Copy `.env.ai-community.example` → `.env` on the box; fill `DATABASE_URL`,
   `AUTH_SECRET` (`openssl rand -base64 32`), and `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET`
   (of the registration covering `cari.rnd.huawei.com`). `ENABLE_SSO=true` is already set there.
2. In the IDaaS console (`https://console-kwe.his.huawei.com/idaas/app/`), open that
   registration and confirm **应用域名** covers `https://cari.rnd.huawei.com`
   (host root). 应用域名 is comma-separated multi-domain — adding a host there is
   self-service and effective immediately.
3. Paste `deploy/ai-community.nginx.conf` **above** the catch-all `location /` in the
   `cari.rnd.huawei.com` server block, then `nginx -t && nginx -s reload`.
4. Build & run (basePath is baked at build time):
   ```bash
   pnpm install
   pnpm prisma migrate deploy
   NEXT_BASE_PATH=/ai-community pnpm build
   # NOTE: call next directly via `pnpm exec` — `pnpm start -- -p 3100` leaks the `--`
   # into next on pnpm v8+, which then treats `-p` as a directory and crashes.
   NEXT_BASE_PATH=/ai-community pnpm exec next start -p 3100 -H 127.0.0.1
   ```
5. Visit `https://cari.rnd.huawei.com/ai-community/auth/login` → **both** the
   "Email & Password" card and the "Huawei W3 SSO" card show. Click W3 → uniportal →
   back logged in; a `User` row gets `huaweiW3Id` + `authMethod = huawei_sso` (or `both`).

> External AWS deploy is untouched: it keeps `ENABLE_SSO=false` (or just omits the SSO
> vars), so the W3 card never renders and it stays pure email/password.

## Run it as a systemd service (production)

Don't leave `next start` in a foreground terminal (it dies on logout). Use the unit shipped
at `deploy/ai-community.service` (already set to `WorkingDirectory=/home/eason/projects/ai-skills-community`,
`User=eason`, `NEXT_BASE_PATH=/ai-community`).

```bash
cd /home/eason/projects/ai-skills-community
which node                                  # absolute node path — systemd does NOT load your shell/nvm/conda PATH
NEXT_BASE_PATH=/ai-community pnpm build      # the service runs `next start`, which needs a build

sudo cp deploy/ai-community.service /etc/systemd/system/ai-community.service
# Make ExecStart's node path match `which node` (the repo default is this box's nvm node;
# the nvm path contains the node VERSION, so re-check after any `nvm install`):
NODEBIN="$(which node)"
sudo sed -i "s#^ExecStart=.*#ExecStart=$NODEBIN node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1#" /etc/systemd/system/ai-community.service
cat /etc/systemd/system/ai-community.service   # sanity-check WorkingDirectory + ExecStart

sudo systemctl daemon-reload
sudo systemctl enable --now ai-community
systemctl status ai-community --no-pager       # want: active (running)
journalctl -u ai-community -f                  # want: ✓ Ready / Listening on 127.0.0.1:3100
```

Update flow afterwards: `git pull && NEXT_BASE_PATH=/ai-community pnpm build && sudo systemctl restart ai-community`
(add `pnpm prisma migrate deploy` only when a migration was added).

**systemd failure decoder** (`systemctl status` shows the code):

| Symptom | Cause / fix |
|---------|-------------|
| `status=200/CHDIR` | `WorkingDirectory` doesn't exist or isn't traversable — usually a stale/placeholder path. Set it to the real dir and re-`cp` (watch for a dropped `/home/eason` — `~` does NOT expand inside a unit file); `ls -ld` the path; `sudo -u eason test -d <dir> && echo ok`. |
| `Invalid project directory … /-p` / `node start` does nothing | `ExecStart` is malformed — must be the FULL `<node> node_modules/next/dist/bin/next start -p 3100 -H 127.0.0.1` (a bare `<node> start`, or `pnpm start -- -p`, breaks). |
| `Could not find a production build in '.next'` | Run `NEXT_BASE_PATH=/ai-community pnpm build` before starting. |
| `node: command not found` / native lib error | `ExecStart` node path wrong, or nvm/conda libs missing — use the absolute `which node`, and add `Environment=PATH=…/bin:/usr/bin:/bin`. |
| port already in use | a leftover foreground `next start` still holds 3100 — `sudo ss -ltnp 'sport = :3100'`, kill it. |
| `EACCES` on `.next`/`storage` | files not owned by `eason` — `sudo chown -R eason:eason <dir>`. |

> Don't put `.env` in systemd `EnvironmentFile=` — it has inline `#` comments that systemd
> would swallow into values. Next auto-loads `.env` from `WorkingDirectory`; leave it to Next.
> Don't "fix" a broken service with `systemctl restart nginx` — different service; nginx on
> this box isn't even systemd-managed (see the nginx note below).

Everything below is the **generic reference** (the `<SUBPATH>` form, registration rule,
nginx rationale, troubleshooting, and what the code already does).

---

## How it works (so the moving parts make sense)

- The app runs as a normal Next.js server on some local port (e.g. `127.0.0.1:3100`),
  reverse-proxied at `https://cari.rnd.huawei.com/<SUBPATH>/`.
- Login is a NextAuth (Auth.js v5) custom OAuth provider with id `huawei`. NextAuth
  handles the browser redirect, CSRF `state`, callback, and the JWT session.
- Huawei's protocol is non-standard (JSON token body, POST userinfo, no `token_type`),
  so a `customFetch` in `lib/auth/huawei-fetch.ts` reshapes the token/userinfo calls.
  You don't need to touch that — it's already correct.
- NextAuth's callback URL is **`<AUTH_URL>/callback/huawei`** — and because `AUTH_URL`
  itself ends in `…/<SUBPATH>/api/auth`, that resolves to
  `…/<SUBPATH>/api/auth/callback/huawei`. That is the URL Huawei must redirect back to,
  and it must obey Huawei's redirect_uri rule.
- **Subpath gotcha (important):** Auth.js's `basePath` must equal the auth API's real
  mount path under the Next basePath — `/<SUBPATH>/api/auth`, NOT `/api/auth`. The code
  pins it from `NEXT_PUBLIC_BASE_PATH` (`lib/auth.ts` server, `components/AuthProvider.tsx`
  client), so a single correct `NEXT_BASE_PATH` drives both. Set `AUTH_URL` to the same
  `…/<SUBPATH>/api/auth` so its origin (used behind the proxy) and path agree — a value
  of just `…/<SUBPATH>` would build the callback as `…/<SUBPATH>/callback/huawei` and fail.

## D2: reuse an existing registration (recommended, least friction)

Huawei's rule is *"redirect_uri path must be a subdirectory of the registered 应用域名"*
(host must match exactly; subdomains do NOT count). So the callback
`https://cari.rnd.huawei.com/<SUBPATH>/api/auth/callback/huawei` is valid under any
registration whose 应用域名 covers `https://cari.rnd.huawei.com`. To reuse one:

1. Reuse that registration's `SSO_CLIENT_ID` and `SSO_CLIENT_SECRET` (same APPID, you own both).
2. In the IDaaS console (`https://console-kwe.his.huawei.com/idaas/app/`), open the
   registration and confirm **应用域名** includes the host root
   `https://cari.rnd.huawei.com` (not pinned to a path). 应用域名 is comma-separated
   multi-domain — adding a host is self-service and effective immediately, so an
   existing registration (e.g. ai4news's) can be extended to cover a new domain
   without a new client_id.
3. No new client_id, and you inherit the already-approved extra userinfo fields
   (`uid` / `displayNameCn` / `email`).

> If you'd rather isolate (D1): create a new registration with its own client_id, set
> 应用域名 = `https://cari.rnd.huawei.com`, and tick `uid`/`displayNameCn`/`email` under
> 用户信息申请. Everything else below is identical.

## Step 1 — environment variables (prod)

```bash
ENABLE_SSO=true
AUTH_SECRET=<random 32+ byte string>                       # openssl rand -base64 32
AUTH_URL=https://cari.rnd.huawei.com/<SUBPATH>/api/auth     # MUST end in /api/auth
NEXT_BASE_PATH=/<SUBPATH>                                   # build-time; no trailing slash

SSO_CLIENT_ID=<client_id covering cari.rnd.huawei.com>     # D2 reuse
SSO_CLIENT_SECRET=<its client_secret>
SSO_AUTHORIZE_URL=https://uniportal.huawei.com/saaslogin1/oauth2/authorize
SSO_ACCESS_TOKEN_URL=https://uniportal.huawei.com/saaslogin1/oauth2/accesstoken
SSO_USERINFO_URL=https://uniportal.huawei.com/saaslogin1/oauth2/userinfo
SSO_SCOPE=base.profile
SSO_VERIFY_SSL=false                                        # uniportal's internal cert often won't validate

# Outbound egress. NOT an SSO-only knob: 知识库 URL 导入 and any external LLM have no
# route off this box without it. Routing is PER HOST (lib/net/proxy.ts) — the default
# bypass list keeps uniportal/w3/10.x direct, so enabling this cannot break W3 login.
USE_PROXY=true
HUAWEI_PROXY_HOST=proxyca.huawei.com      # host only — no scheme, no ":8080"
HUAWEI_PROXY_PORT=8080
# PROXY_BYPASS unset ⇒ localhost,127.0.0.1,::1,.huawei.com,10/8,172.16/12,192.168/16,169.254/16
# proxyca TLS-intercepts; trust its CA one of three ways (see below).
# PROXY_CA_FILE=/etc/ssl/certs/huawei-ca-bundle.pem
PROXY_TLS_INSECURE=false
```

**Trusting the proxy's CA.** proxyca re-signs every https response with an internal
CA, so a tunnelled request fails with `unable to verify the first certificate` until
one of these is in place:

1. `PROXY_CA_FILE=<pem>` in `.env` — read by the app, so `.env` works.
2. `Environment=NODE_EXTRA_CA_CERTS=<pem>` in `deploy/ai-community.service`.
   ⚠️ **This one must NOT go in `.env`** — Node builds its trust store at process
   start, before Next loads `.env`, so a `.env` line has zero effect.
3. `PROXY_TLS_INSECURE=true` — blunt fallback. Skips verification for **proxied**
   requests only; direct requests stay strict.

Env changes here take effect on `systemctl restart` — **no rebuild needed** (they are
parsed from `process.env` at runtime). Verify the result at
管理后台 → 知识库 → **网络出口 (Proxy) 诊断**, which shows the resolved proxy URI, the
bypass list, which CA is in use, and the raw errno of a live probe.

`NEXT_BASE_PATH` must be present **at build time** (`next build`), not just runtime —
Next bakes `basePath` into the build.

## Step 2 — register the redirect_uri with Huawei

Register (or confirm covered by the registered 应用域名):

```
https://cari.rnd.huawei.com/<SUBPATH>/api/auth/callback/huawei
```

Rule reminder: host+port must match the registered 应用域名 exactly; the path must be a
subdirectory of it; **a different subdomain does NOT count**. A mismatch → `E_10004`.

## Step 3 — nginx

Add this **above** the catch-all `location /` block. Note: **no trailing slash** on
`proxy_pass` — the `/<SUBPATH>/` prefix must be preserved for Next's `basePath`
(unlike `/cari_dste/` which uses a trailing slash to strip its prefix).

```nginx
location /<SUBPATH>/ {
    proxy_pass         http://127.0.0.1:3100;   # the app's port; NO trailing slash
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto https;
    proxy_set_header   Upgrade $http_upgrade;     # Next HMR / streaming
    proxy_set_header   Connection "upgrade";
}
# optional: redirect the bare path to the trailing-slash form
location = /<SUBPATH> { return 301 /<SUBPATH>/; }
```

## Step 4 — build & run

```bash
pnpm install
pnpm prisma migrate deploy          # the huaweiW3Id / authMethod columns already exist in the schema
NEXT_BASE_PATH=/<SUBPATH> pnpm build
NEXT_BASE_PATH=/<SUBPATH> pnpm exec next start -p 3100 -H 127.0.0.1   # NOT `pnpm start -- -p` (the `--` leaks into next)
```

## Step 5 — verify the round trip

1. Visit `https://cari.rnd.huawei.com/<SUBPATH>/auth/login` → the "Huawei W3 SSO" button shows (only when `ENABLE_SSO=true`).
2. Click it → you land on `uniportal.huawei.com/saaslogin1/oauth2/authorize?...`.
3. After W3 auth → back to `…/<SUBPATH>/api/auth/callback/huawei` → you're logged in.
4. In Postgres, a `User` row exists with `huaweiW3Id` set and `authMethod = huawei_sso`
   (or `both` if the email already had a password account), plus a `LoginEvent`.

## Domain separation: `/ai-community` lives ONLY on cari.rnd.huawei.com

Owner decision (2026-08): the two hostnames are **separate sites**. news keeps
`ai4news.rnd.huawei.com` exactly as-is — **no news-side change of any kind** — and ai-community
answers only on `cari.rnd.huawei.com`. The 2026-08 `InvalidCheck: state value could not be
parsed` incident happened because `/ai-community` ALSO answered on the news hostname: a W3 login
started there wrote its host-scoped state cookie into the ai4news jar while `AUTH_URL` pinned
the OAuth callback to cari. The separation is enforced entirely on the ai-community side, three
layers deep:

1. **nginx**: the `/ai-community` locations must exist only under the cari `server_name`
   (audit with `sudo nginx -T | grep -n 'server_name\|location.*ai-community'`). If one
   `server { }` answers both names, the `if ($host != "cari.rnd.huawei.com") return 301`
   guards inside both `/ai-community` locations (deploy/ai-community.nginx.conf) enforce the
   split without touching anything news serves. 301 — not 404 — so old `/ai-community` links
   circulating inside news bounce to cari and keep working.
2. **App backstop**: the root layout redirects any page served on a non-canonical host to
   `AUTH_URL`'s origin (SSO deploys only; loopback/IP exempt) — survives nginx config drift.
3. **Cookies**: app-scoped `aic.*` names path-limited to the basePath, so foreign/stale
   residue in either jar can never be misread.

Verify after reloading nginx (`nginx -t` then `kill -HUP <master>` — pitfall 3):

```bash
curl -sI https://ai4news.rnd.huawei.com/ai-community/ | grep -i location  # 301 → cari, path intact
curl -sI https://ai4news.rnd.huawei.com/              | head -1           # news unaffected (200/30x as before)
curl -sI https://cari.rnd.huawei.com/ai-community/    | head -1           # app serves normally
```

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `E_10004` redirect_uri error | The callback isn't a subdirectory of a registered 应用域名 (subdomain/port/path mismatch). Register the exact host, or add it to 应用域名. |
| `E_10001` client_id error | Wrong env (prod vs test `uniportal` vs `uniportal-beta`) or wrong client_id. |
| TLS / cert verification error reaching uniportal | Keep `SSO_VERIFY_SSL=false` (uses an undici verify-off agent). Preferred alternative: `Environment=NODE_EXTRA_CA_CERTS=<huawei CA bundle>` in the systemd unit (never in `.env`). |
| 知识库 上传链接 报 `无法解析域名 …（当前为直连出口）` | No egress configured. Set `USE_PROXY=true` + `HUAWEI_PROXY_HOST` and `systemctl restart`. |
| 知识库 报 `代理证书未被信任` | proxyca's MITM CA isn't trusted — set `PROXY_CA_FILE`, or `NODE_EXTRA_CA_CERTS` in the systemd unit, or `PROXY_TLS_INSECURE=true`. |
| 知识库 报 `代理拒绝了该目标（HTTP 403）` | An intranet target was pushed through the proxy. Add its host to `PROXY_BYPASS` (`.huawei.com` and RFC1918 are bypassed by default). |
| W3 login breaks right after enabling the proxy | Should no longer happen — `lib/auth.ts` derives `useProxy` per host from the bypass list. If it does, check `PROXY_BYPASS` was overridden without re-adding `.huawei.com`. |
| Proxy settings appear to have no effect | `HTTP_PROXY`/`HTTPS_PROXY` alone are inert for undici; the app reads them explicitly but only after a **restart** (`lib/env.ts` snapshots `process.env` at import). Confirm with 管理后台 → 知识库 → 网络出口 (Proxy) 诊断. |
| Assets 404 / login redirects to `/` instead of `/<SUBPATH>/` | `NEXT_BASE_PATH` / `AUTH_URL` / nginx `<SUBPATH>` disagree, or `proxy_pass` has a trailing slash. Make all four identical. |
| Login/logout buttons hit `<origin>/api/auth/*` (404 / lands on the neighbour app) instead of `…/<SUBPATH>/api/auth/*` | The next-auth React client can't read `AUTH_URL` in the browser, so it must be told the basePath. `components/AuthProvider.tsx` sets `SessionProvider basePath = NEXT_PUBLIC_BASE_PATH + /api/auth`. Ensure `NEXT_PUBLIC_BASE_PATH` is present **at build time** (next.config derives it from `NEXT_BASE_PATH`). |
| `UnknownAction: Cannot parse action at /api/auth/…` + "Bad request" on every login (W3 *and* password) | Next strips `NEXT_BASE_PATH` from inbound route-handler URLs, so @auth/core (basePath `<SUBPATH>/api/auth`) sees `/api/auth/…` and can't match. `lib/auth-handlers.ts` re-adds the basePath to inbound requests. If you see this, that wrapper is missing/edited — restore it. |
| W3 login succeeds but lands on the host root (the neighbour app), not `…/<SUBPATH>/` | The W3 flow ends in a server redirect that Next does NOT auto-prefix. `HuaweiLoginButton` must pass a `withBasePath()`-prefixed `callbackUrl`. |
| `redirected you too many times` on `…/<SUBPATH>` after login | nginx `location = /<SUBPATH> { return 301 /<SUBPATH>/; }` fights Next's 308 (`/<SUBPATH>/` → `/<SUBPATH>`, trailingSlash=false). **Proxy** the bare path instead of 301-ing it — see `deploy/ai-community.nginx.conf`. |
| `AuthCode has been used` (`E_20003`) | A browser/proxy prefetched the callback and consumed the one-time code. The dedicated `/api/auth/callback/huawei` path avoids this; check no prefetcher hits it. |
| `[auth][error] InvalidCheck: state value could not be parsed` — always for SOME users (news users / newcomers), never for others; user sees "登录遇到问题 (Configuration)" | **Hostname-alias cookie split.** The server block also answers on its pre-2026-07 name (`ai4news.rnd.huawei.com`), which news users still enter through (the news app's `SITE_URL`/`SSO_REDIRECT_URI` pin them there). Auth cookies are host-scoped, so a login started on the alias writes its state cookie into the alias' jar — while `AUTH_URL` sends the IdP callback to `cari`, whose jar has no (or stale) state cookie. In 0.37.2 a *missing* cookie surfaces with this same message. Fixes (all shipped): nginx 301s any non-`cari` host to `cari` inside both `/ai-community` locations (re-paste `deploy/ai-community.nginx.conf` + `kill -HUP` the master); the root layout bounces alias-served pages to `AUTH_URL`'s origin as an app-level backstop; and cookies are now app-scoped (`aic.*`, path-limited) so no other epoch/app accidentally shadows them. Verify: `curl -sI https://ai4news.rnd.huawei.com/ai-community/ \| grep -i location` → 301 to cari. |
| Everyone is logged out after deploying the cookie rename | Expected, one-time: cookie **names are the JWT salt** in @auth/core, so `authjs.*` → `aic.*` invalidates existing sessions (and any W3 round trip mid-flight during the restart). Users just sign in again. |
| userinfo only returns `uuid` | The registration's 用户信息申请 lacks the extra fields. D2 reuse of ai4news inherits them; for D1 tick `uid`/`displayNameCn`/`email`. |

## What the code already does (no edits needed)

- `lib/auth.ts` — `huawei` custom OAuth provider: `checks:['state']` (Huawei has no PKCE),
  `display=page`, correct `profile()` field mapping (`uid→uuid→globalUserID`,
  `displayNameCn→displayName→cn→givenName`), wired to the customFetch below.
- `lib/auth/huawei-fetch.ts` — reshapes token (form→JSON, injects `token_type`, drops
  epoch-ms `expires_in`) and userinfo (GET+Bearer→POST+JSON body), checks `errorCode`,
  and applies the TLS-verify-off / proxy dispatcher.
- `tests/huawei-fetch.test.ts` — unit coverage for the reshaping.
- `next.config.mjs` — env-driven `basePath` (+ exposes `NEXT_PUBLIC_BASE_PATH` to the client).
- `components/AuthProvider.tsx` — wraps the app in `SessionProvider basePath=<NEXT_PUBLIC_BASE_PATH>/api/auth`
  so the browser-side `signIn()`/`signOut()` target this app's API under the subpath (not the origin root).
- `lib/auth-handlers.ts` — re-adds the stripped `NEXT_BASE_PATH` to inbound auth requests so @auth/core
  can parse the action (Next strips basePath from route-handler URLs; without this every login 400s).
- Login page (`app/auth/login/page.tsx`) renders **both** the email/password form and the W3 card
  (`isSsoEnabled && …`); the W3 card only appears when `ENABLE_SSO=true` + client id/secret are set.
