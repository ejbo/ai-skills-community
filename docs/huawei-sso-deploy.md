# Huawei W3 / UniPortal (IDaaS) SSO — deployment guide

How to turn on Huawei W3 login for this app in the internal environment. The **code**
is already done and subpath-agnostic; this guide is the **config** you apply at deploy.

Replace `<SUBPATH>` below with the path you mount the app under (e.g. `community`).
Everything must use the **same** `<SUBPATH>`: `NEXT_BASE_PATH`, `AUTH_URL`, the nginx
`location`, and the redirect_uri you register with Huawei.

---

## ⭐ This rollout (locked): `/ai-community` on `ai4news.rnd.huawei.com`

Concrete values for the current internal deploy — **D2 (reuse ai4news's `client_id`),
direct egress**. Ready-to-use artifacts:
[`../.env.ai-community.example`](../.env.ai-community.example) and
[`../deploy/ai-community.nginx.conf`](../deploy/ai-community.nginx.conf).

| Setting | Value |
|---|---|
| Host (正统域名, **unchanged**) | `ai4news.rnd.huawei.com` |
| New subpath | `/ai-community` |
| `AUTH_URL` | `https://ai4news.rnd.huawei.com/ai-community/api/auth` ⚠️ must include `/api/auth` |
| `NEXT_BASE_PATH` | `/ai-community` |
| Callback to register/confirm | `https://ai4news.rnd.huawei.com/ai-community/api/auth/callback/huawei` |
| `client_id` / `secret` | reuse ai4news's (D2) |
| `USE_PROXY` | `false` (direct) — `SSO_VERIFY_SSL=false` |
| App upstream port | `127.0.0.1:3100` (any free port; must match nginx + the `next start -p`) |

**Steps**

1. Copy `.env.ai-community.example` → `.env` on the box; fill `DATABASE_URL`,
   `AUTH_SECRET` (`openssl rand -base64 32`), and `SSO_CLIENT_ID` / `SSO_CLIENT_SECRET`
   (= ai4news's). `ENABLE_SSO=true` is already set there.
2. In the IDaaS console (`https://console-kwe.his.huawei.com/idaas/app/`), open
   ai4news's registration and confirm **应用域名** covers `https://ai4news.rnd.huawei.com`
   (host root). If it's pinned to `/authorize`, add the host root (or `…/ai-community`)
   to the comma-separated 应用域名 — self-service, effective immediately.
3. Paste `deploy/ai-community.nginx.conf` **above** the catch-all `location /` in the
   ai4news server block, then `nginx -t && nginx -s reload`.
4. Build & run (basePath is baked at build time):
   ```bash
   pnpm install
   pnpm prisma migrate deploy
   NEXT_BASE_PATH=/ai-community pnpm build
   # NOTE: call next directly via `pnpm exec` — `pnpm start -- -p 3100` leaks the `--`
   # into next on pnpm v8+, which then treats `-p` as a directory and crashes.
   NEXT_BASE_PATH=/ai-community pnpm exec next start -p 3100 -H 127.0.0.1
   ```
5. Visit `https://ai4news.rnd.huawei.com/ai-community/auth/login` → **both** the
   "Email & Password" card and the "Huawei W3 SSO" card show. Click W3 → uniportal →
   back logged in; a `User` row gets `huaweiW3Id` + `authMethod = huawei_sso` (or `both`).

> External AWS deploy is untouched: it keeps `ENABLE_SSO=false` (or just omits the SSO
> vars), so the W3 card never renders and it stays pure email/password.

Everything below is the **generic reference** (the `<SUBPATH>` form, registration rule,
nginx rationale, troubleshooting, and what the code already does).

---

## How it works (so the moving parts make sense)

- The app runs as a normal Next.js server on some local port (e.g. `127.0.0.1:3100`),
  reverse-proxied at `https://ai4news.rnd.huawei.com/<SUBPATH>/`.
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

## D2: reuse ai4news's registration (recommended, least friction)

Because this app sits on the **same host** as ai4news (`ai4news.rnd.huawei.com`), and
Huawei's rule is *"redirect_uri path must be a subdirectory of the registered 应用域名"*,
the new callback `…/<SUBPATH>/api/auth/callback/huawei` is already a valid subdirectory
of ai4news's registered host. So:

1. Reuse ai4news's `SSO_CLIENT_ID` and `SSO_CLIENT_SECRET` (same APPID, you own both).
2. In the IDaaS console (`https://console-kwe.his.huawei.com/idaas/app/`), open ai4news's
   registration and confirm **应用域名** is registered at the host root
   `https://ai4news.rnd.huawei.com` (not pinned to `/authorize`). If it is pinned, add the
   host root (or `…/<SUBPATH>`) to the comma-separated 应用域名 — self-service, immediate.
3. No new client_id, and you inherit ai4news's already-approved extra userinfo fields
   (`uid` / `displayNameCn` / `email`).

> If you'd rather isolate (D1): create a new registration with its own client_id, set
> 应用域名 = `https://ai4news.rnd.huawei.com`, and tick `uid`/`displayNameCn`/`email` under
> 用户信息申请. Everything else below is identical.

## Step 1 — environment variables (prod)

```bash
ENABLE_SSO=true
AUTH_SECRET=<random 32+ byte string>                       # openssl rand -base64 32
AUTH_URL=https://ai4news.rnd.huawei.com/<SUBPATH>/api/auth  # MUST end in /api/auth
NEXT_BASE_PATH=/<SUBPATH>                                   # build-time; no trailing slash

SSO_CLIENT_ID=<ai4news client_id>                          # D2 reuse
SSO_CLIENT_SECRET=<ai4news client_secret>
SSO_AUTHORIZE_URL=https://uniportal.huawei.com/saaslogin1/oauth2/authorize
SSO_ACCESS_TOKEN_URL=https://uniportal.huawei.com/saaslogin1/oauth2/accesstoken
SSO_USERINFO_URL=https://uniportal.huawei.com/saaslogin1/oauth2/userinfo
SSO_SCOPE=base.profile
SSO_VERIFY_SSL=false                                        # uniportal's internal cert often won't validate

# Only if the app's server cannot reach uniportal.huawei.com directly:
USE_PROXY=false
HUAWEI_PROXY_HOST=proxyca.huawei.com
HUAWEI_PROXY_PORT=8080
```

`NEXT_BASE_PATH` must be present **at build time** (`next build`), not just runtime —
Next bakes `basePath` into the build.

## Step 2 — register the redirect_uri with Huawei

Register (or confirm covered by ai4news's 应用域名):

```
https://ai4news.rnd.huawei.com/<SUBPATH>/api/auth/callback/huawei
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

1. Visit `https://ai4news.rnd.huawei.com/<SUBPATH>/auth/login` → the "Huawei W3 SSO" button shows (only when `ENABLE_SSO=true`).
2. Click it → you land on `uniportal.huawei.com/saaslogin1/oauth2/authorize?...`.
3. After W3 auth → back to `…/<SUBPATH>/api/auth/callback/huawei` → you're logged in.
4. In Postgres, a `User` row exists with `huaweiW3Id` set and `authMethod = huawei_sso`
   (or `both` if the email already had a password account), plus a `LoginEvent`.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `E_10004` redirect_uri error | The callback isn't a subdirectory of a registered 应用域名 (subdomain/port/path mismatch). Register the exact host, or add it to 应用域名. |
| `E_10001` client_id error | Wrong env (prod vs test `uniportal` vs `uniportal-beta`) or wrong client_id. |
| TLS / cert verification error reaching uniportal | Keep `SSO_VERIFY_SSL=false` (uses an undici verify-off agent). If undici isn't resolvable in your runtime, set `NODE_EXTRA_CA_CERTS=<huawei CA bundle>` (preferred) or `NODE_TLS_REJECT_UNAUTHORIZED=0` on the process. |
| Assets 404 / login redirects to `/` instead of `/<SUBPATH>/` | `NEXT_BASE_PATH` / `AUTH_URL` / nginx `<SUBPATH>` disagree, or `proxy_pass` has a trailing slash. Make all four identical. |
| Login/logout buttons hit `<origin>/api/auth/*` (404 / lands on the neighbour app) instead of `…/<SUBPATH>/api/auth/*` | The next-auth React client can't read `AUTH_URL` in the browser, so it must be told the basePath. `components/AuthProvider.tsx` sets `SessionProvider basePath = NEXT_PUBLIC_BASE_PATH + /api/auth`. Ensure `NEXT_PUBLIC_BASE_PATH` is present **at build time** (next.config derives it from `NEXT_BASE_PATH`). |
| `AuthCode has been used` (`E_20003`) | A browser/proxy prefetched the callback and consumed the one-time code. The dedicated `/api/auth/callback/huawei` path avoids this; check no prefetcher hits it. |
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
- Login page (`app/auth/login/page.tsx`) renders **both** the email/password form and the W3 card
  (`isSsoEnabled && …`); the W3 card only appears when `ENABLE_SSO=true` + client id/secret are set.
