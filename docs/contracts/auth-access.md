# 登录、跳转、权限与身份 (auth, RBAC, identity)

> 从 CLAUDE.md 拆出。

## /manage 闸门与登录跳转

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

## 角色与权限、页面访问、身份脱敏、员工名单

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
- **管理身份不出现在成员界面 (2026-08-27).** `publicRoleBadge` (`lib/permissions.ts`) is the ONLY
  way a role name reaches a member-facing payload. It drops `member` AND every staff role — where
  "staff" is `isStaff`, i.e. carries at least one permission — so 超级管理员/管理员 never appear on
  a profile, a 用户卡片 or an annotation byline. An HONORIFIC role survives on purpose: a 专家 role
  created with an EMPTY permission list still badges, which is what the 共享批注 feature was built
  around. The trim happens at the SERVER boundary (`/api/users/[handle]/card`,
  `/api/library/docs/[id]/notes`), never as a client-side hide, and the role's `permissions` must be
  in the select for it to work. The staff's own 管理后台 link in `UserMenu` is unaffected — that is
  the operator seeing their own tools, not a badge shown to others.
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
