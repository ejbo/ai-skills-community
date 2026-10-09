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


## 先打开对应的契约文档

本文件只放**在你还不知道要动哪块之前就成立**的规则。每个功能自己的完整契约——不变量、它们
来自哪个 bug、哪些东西不能"顺手简化"掉——都在 `docs/contracts/` 里。**动某块之前先打开它对应
的那份**：那些不是背景资料，是真实调试时间沉淀下来的。

| 区域 | 路由 / 入口 | 契约文档 |
| --- | --- | --- |
| 部署、子路径、nginx、W3 cookie | `/ai-community` | [`docs/contracts/deploy.md`](docs/contracts/deploy.md) |
| 登录跳转、RBAC、身份脱敏、员工名单 | `/manage`, `/auth/*` | [`docs/contracts/auth-access.md`](docs/contracts/auth-access.md) |
| 富文本编辑器、表情包、`[poll:]` 组件 | 所有编辑器 | [`docs/contracts/editor.md`](docs/contracts/editor.md) |
| 技术专区、Wiki、栏目、组织架构 | `/zones` | [`docs/contracts/zones.md`](docs/contracts/zones.md) |
| 动态 / 讨论区、意见反馈 | `/discussion`, `/feedback` | [`docs/contracts/discussion.md`](docs/contracts/discussion.md) |
| 投票活动（作品评选） | `/votes` | [`docs/contracts/votes.md`](docs/contracts/votes.md) |
| 知识库、阅读器、共享批注 | `/library` | [`docs/contracts/library.md`](docs/contracts/library.md) |
| 长视频、随刷短视频、字幕 | `/videos` | [`docs/contracts/video.md`](docs/contracts/video.md) |
| 活动日历、报名、提醒 | `/events` | [`docs/contracts/events.md`](docs/contracts/events.md) |
| 个人主页、名片、悬停卡片 | `/users/[handle]` | [`docs/contracts/profile.md`](docs/contracts/profile.md) |
| 配色、导航栏、首页、GitHub 热榜 | 全站 chrome | [`docs/contracts/ui.md`](docs/contracts/ui.md) |
| 站内翻译（翻译 / 显示原文 / 自动翻译） | 所有帖子·评论 | [`docs/contracts/translate.md`](docs/contracts/translate.md) |
| 可见范围（公开 / 隐藏 / 指定成员可见）、人员选择器 | 投票（今后帖子·文章） | [`docs/contracts/audience.md`](docs/contracts/audience.md) |
| 链接用标题命名（slug / id / 旧链接重定向） | 活动·话题·反馈·公告·专区帖子·Wiki·视频·投票·知识库 | [`docs/contracts/slugs.md`](docs/contracts/slugs.md) |
| 出口代理、LLM、邮件、通知、i18n、演示数据 | 基础设施 | [`docs/contracts/platform.md`](docs/contracts/platform.md) |

其他长文档：`docs/huawei-sso-deploy.md`（部署全流程）、`docs/events-capabilities.md`
（活动面向用户的能力清单——做胶片/写文档直接取用，不要再开调研重读代码）、
`docs/library-capabilities.md`（文章板块能力清单 + 推介口径，同上）、
`docs/capacity-tuning.md`、`docs/video-performance-notes.md`、`docs/skills-cli-usage.md`。

## 内部部署（`/ai-community`）

全流程见 `docs/huawei-sso-deploy.md`；产物：`.env.ai-community.example`、
`deploy/ai-community.nginx.conf`、`deploy/ai-community.service`。服务器上：

```bash
cp .env.ai-community.example .env     # 填 DATABASE_URL, AUTH_SECRET, SSO_CLIENT_ID/SECRET
pnpm install && pnpm prisma migrate deploy
NEXT_BASE_PATH=/ai-community pnpm build
NEXT_BASE_PATH=/ai-community pnpm exec next start -p 3100 -H 127.0.0.1   # 前台自测
```

生产用 systemd（`deploy/ai-community.service`）。`git pull` 之后：
`NEXT_BASE_PATH=/ai-community pnpm build && sudo systemctl restart ai-community`。

## Pitfalls（每条都真花过时间；细节在 `docs/contracts/deploy.md`）

1. **`pnpm start -- -p 3100` 是坏的**（pnpm v8+ 把 `--` 漏给 next）。用
   `pnpm exec next start -p 3100 -H 127.0.0.1`，systemd 里直接调 node 绝对路径。
2. **`next start` 需要先有生产构建**，且 `pnpm build` 会校验 `.env` —— 先填 `.env` 再构建。
3. **这台机器的 nginx 不归 systemd 管**。`sudo ps -o pid,ppid,args -C nginx` → `sudo kill -HUP <master-pid>`。
   **绝不 `systemctl restart nginx`** —— 它起不来，还会带走 ai4news/cari_dste。
4. **子路径 + Auth.js v5 是六处联动**（`next.config.mjs` / `lib/auth.ts` / `lib/auth-handlers.ts` /
   `AuthProvider` / `HuaweiLoginButton` / `.env` 的 `AUTH_URL`）。**任何一处都不能"简化"掉。**
5. nginx `^~ /ai-community/` 的 `proxy_pass` **不能带结尾斜杠**（与 `/cari_dste/` 相反）。
6. 裸路径 `/ai-community` 必须**代理**给 app，不能 `301` 到带斜杠版本（会和 Next 的 308 打架成
   重定向死循环）；也不要用 `trailingSlash: true` "修"它——那会破坏 W3 回调路径。
7. systemd 不加载 nvm/conda PATH：`ExecStart` 要绝对 node + 完整 next bin 路径；
   `.env` 由 Next 从 `WorkingDirectory` 自动加载，**不要**用 `EnvironmentFile=`。
8. **`/manage` 闸门在服务端，不在 edge middleware**。`middleware.ts` 只做一件事——发布
   `x-pathname`，**任何鉴权判断都不许搬进去**。
8b. **登录后回到原页面**：登录链接只能由 `loginHref()` / `currentLoginHref()` / `selfHref()`
   （`lib/auth/callback-path.ts`）构造，**永远不要再手写** `` `/auth/login?callbackUrl=${pathname}` ``。
   **自助注册已在所有部署关闭**（owner 决定）：`/auth/signup` 重定向到登录页、
   `POST /api/auth/register` 恒 403、登录页无注册入口；账号来自 W3 首登或 `pnpm db:seed`。
9. **客户端 `fetch('/api/...')` 必须带 basePath** —— 见下面「全站契约」。
10. **W3 登录报 `InvalidCheck: state value could not be parsed` 是域名别名导致的 cookie 分裂，
    不是代码 bug**。三层防御（nginx 301 / layout 兜底 / `aic.*` cookie 命名）都要留着。

## 全站契约（写任何代码都成立）

- **basePath**：媒体 URL 一律**存根相对路径**，渲染时过 `withBasePath()`（`lib/base-path.ts`），
  这样内容在根部署和 `/ai-community` 之间可移植。客户端根相对 `fetch('/api/...')` 由
  `lib/patch-fetch.ts`（`installApiBasePathFetch()`，在 `components/AuthProvider.tsx` 安装）
  全局补齐 —— 所以照常写 `fetch('/api/...')` 即可，**别删这个 shim**。
  **但 shim 不覆盖 `<img src>` / `<video src>`**（它们不是 fetch）：任何渲染存储型根相对媒体
  URL 的元素都必须在渲染时包 `withBasePath()`，否则在子路径下 404。
- **env**：`lib/env.ts`（zod）校验。读配置走 `env` 而不是 `process.env`（`NEXT_PUBLIC_*` 除外，
  它们构建期内联）。改 env 要**重启**、不用重新构建。
- **服务端出口**：内网机器没有公网直连路由，每个离开本机的服务端调用都要走 `egressFor(url)`
  或 `egressFetch`（`lib/net/proxy.ts`），**不要裸 `fetch`/`undiciRequest`**。按主机路由，不是
  全局开关。**LLM 调用是例外**：`lib/llm/egress.ts` 的 `llmFetch` 默认直连。细节见 platform.md。
- **i18n（中/EN/FR），不许硬编码 UI 字符串**：字符串进 `messages/{zh-CN,en,fr}.json`（zh-CN 是
  源，三份必须 key 对齐），用 `useTranslations` / `getTranslations` 读。四条踩过的坑：
  分类/枚举的**显示**文案走 `labels.*` 命名空间，但存库/过滤/传 API 的值**永不翻译**；
  相对时间必须走 `relativeTime(date, locale)`（裸 `formatDistanceToNowStrict` 只有英文）；
  消息值里的字面 `<…>` 必须写成 `'<…>'`（否则 next-intl 当富文本标签解析，整条消息渲染成 key）；
  `.ts` 辅助模块不许 import next-intl。`/manage` 后台**按设计保持中文**。
- **配色契约：chrome 全墨，内容有色。** 一条规则决定所有配色问题——*页面自己没有颜色，颜色属于
  材料*。主按钮/开关/激活态/进度条/焦点环一律 `zinc-900`（浅色）/`zinc-100`（深色）；
  `app/**` 和 `components/**` 里**没有任何 `accent-*` 类**，不要复活靛蓝主按钮（用户评价"ai 风很浓"），
  也不要把内容强行做成黑白（用户同样拒绝过）。书脊、GitHub 语言点、来源徽章、评分星、分类色、
  头像（`identityColor` 12 色身份色板）、视频画面**必须保留真实颜色**。三个自带强调色的例外：
  知识库阅读器（`--reader-accent`）、投票活动（`app/votes/_components/vote-theme.ts`，颜色是语义
  不是装饰）、成员名片。完整版见 ui.md。
- **身份与隐私**：作者查询 select `AUTHOR_IDENTITY_SELECT`，**在服务端边界**过
  `toPublicAuthor(author, can(user,'identity'))`（绝不发出去再前端隐藏），UI 用 `<DeptTag/>`。
  角色名到成员界面只能经 `publicRoleBadge`（丢掉 `member` 和所有 staff 角色）。
  任何新的"渲染别人身份"的界面都要照这个 select → trim → DeptTag 走一遍。
- **权限**：`can(session.user, '<domain>')`；`/manage` 页用 `requirePermission`、`/api/admin/*`
  用 `gateApi`（都读 DB，所以撤权下一个请求即生效）。lib 查询helper 收
  `DomainViewer`（`domainViewer(user,'votes')`）—— `canManage`（域）与 `canSeeIdentity`（`identity`）
  是**正交**的。17 个权限键的目录是代码：`lib/permissions.ts`。
- **用户头像**：给 `<Avatar/>` 传 `handle`，它自己会包上悬停名片。只有渲染**自己**的头像
  （导航栏/编辑器/设置）和非用户（活动嘉宾是自由文本）才省略 `handle`。
- **评论**：全站统一 **2 级扁平线程**契约（`parentId` = 线程根，回复子评论会重新挂到其父，
  第三级永远不会出现；瞬时 `replyToId` 只用于通知路由；有回复时留墓碑）。计数器更新用
  **交互式事务里的守卫写**（不要 check-then-act）。点赞按钮用共享的
  `components/CommentLikeButton.tsx`，不要再抄一份；点赞闸门必须**镜像该界面自己的列表路由**。
- **通知**：从**发生变更的那一处**发（评论回复、访问申请、公告扇出），并且
  **通知失败绝不能让底层写入失败**。按用户的 `NotificationPreference` 分发。
- **富文本**：扩展列表只有一份——`components/editor/rich-text-extensions.ts` 的
  `buildRichTextExtensions(opts)`，测试也构建同一份，**不要再把扩展数组抄进测试**。
  长度上限计**可见长度**（服务端 `withRichTextLimit`，客户端 `isRichTextTooLong`）。
- **迁移**：新迁移作为已提交的 SQL 放 `prisma/migrations/`，服务器上 `pnpm prisma migrate deploy`。
- **新页面**：`app/**/page.tsx` 必须在 `lib/page-visit.ts` 的 `PAGE_NAMES` 里登记，
  `tests/page-visit.test.ts` **双向**校验（漏登记或留陈旧条目都会挂）。
- **Skill 上传只有一个入口**：`/skills` 上的「上传 Skill」按钮。头像下拉是去**你自己的**
  界面的导航（主页 / 书架 / 设置），不是创作入口——不要把上传加回去。
