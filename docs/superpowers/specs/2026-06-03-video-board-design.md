# AI 社区 · 视频板块（Video Board）— 设计文档

- **日期**: 2026-06-03
- **分支**: feat/video-board
- **状态**: 待用户评审（设计已通过交互确认，开放问题已拍板）

## 1. 背景与动机

当前仓库 `skills-community` 是一个内部 AI 社区平台，目前只有 **skills**（技能市场）一个板块。本期新增第二个板块：**AI 极客访谈视频站**（YouTube/TikTok 形态）。

**产品形态**：

- **视频首页（feed）** — 网格/列表浏览，支持搜索、分类、排序、分页。
- **视频详情页** — 左主列：HTML5 播放器 → 标题/元信息 → 富文本描述 → 评论区；**右栏：AI 摘要 + AI 对话（"就本视频提问"）**；底部相关视频。
- **互动** — 点赞、收藏（稍后看）、分享；评论支持盖楼回复与评论点赞。
- **后台** — 管理员上传视频、编辑视频文案/元信息。

**两个产品级约束（最高优先级）**：

1. **不得影响 skills 模块的任何代码与功能**。所有改动均为增量，视频代码住在自己的命名空间里。
2. **共用底层设施是允许且鼓励的**：登录/会话、Prisma 连接、存储、LLM、Markdown、限流、审计、i18n。两块用户是同一批、共用同一套登录；日后还会有统一首页同时承载两块数据。

**关系定位**：skills 与 videos 是同一"AI 社区"大伞下两个**相对独立、底层共享**的板块。本仓库已是 pnpm monorepo（`pnpm-workspace.yaml` 含 `.` 与 `cli`），选择"放当前仓库、自成隔离板块、一起部署"，从而免费获得共用登录与未来统一首页，同时把"隔离"收敛为可控的代码组织问题。

## 2. 架构与隔离原则

### 2.1 命名空间（视频板块的全部落点）

```
app/videos/                      # 用户侧：feed + [slug] 详情页（自带 layout）
app/manage/videos/               # 后台：列表 / new / [id]/edit（已被 middleware 的 /manage/* 自动护住）
app/api/videos/                  # 所有视频 API
lib/video/                       # 领域逻辑：queries / access / blob / ai / types
components/video/                # 仅视频用组件
prisma/schema.prisma             # 末尾新增 Video* 模型（清晰分节）
messages/{zh-CN,en}.json         # 新增 video.* i18n key
```

### 2.2 唯一允许复用的共享层

| 共享模块 | 用途 |
|---|---|
| [lib/db.ts](../../../lib/db.ts) | Prisma 单例 |
| [lib/auth.ts](../../../lib/auth.ts) | `auth()` 会话 |
| [lib/admin.ts](../../../lib/admin.ts) | `requireAdmin` / `requireUser` |
| [lib/llm](../../../lib/llm) | `getProvider()` / `streamDeltas` / `complete` / `toSseResponseStream`（默认 Anthropic `claude-haiku-4-5-20251001`） |
| [lib/markdown.ts](../../../lib/markdown.ts) + [components/MarkdownRenderer.tsx](../../../components/MarkdownRenderer.tsx) | 描述/正文渲染 |
| [lib/rate-limit.ts](../../../lib/rate-limit.ts) | 限流（视频 key 加 `video-*` 前缀避免撞 skills） |
| [lib/audit.ts](../../../lib/audit.ts) | `logAdmin`（`AdminLog.targetType` 为自由 String，`targetType:'Video'` 无需改表） |
| [lib/env.ts](../../../lib/env.ts) | 环境变量校验 |
| 通用组件 | `NavBar` / `ThemeProvider` / `Toaster` / `EmptyState` / `SearchBar` / `SortMenu` / `lib/clipboard.ts` 等 |

### 2.3 隔离边界（硬约束，写入验收）

1. `lib/video/*`、`components/video/*` **禁止** import 任何 `lib/skill-*`、`app/skills/*` 或 skill 形态的辅助模块。**特别地：禁止 import 或修改 [lib/access.ts](../../../lib/access.ts)**（它是 skill 形态、且是所有 skill 内容门禁/CLI 的总入口）——视频另写纯模块 `lib/video/access.ts`。
2. skills 代码**禁止** import `lib/video/*`。
3. 数据库：所有 `Video*` 模型**只 FK 到 `User` 或 `Video*`**，绝不 FK 到 `Skill`。对现有表的唯一改动 = 给 `User` 追加反向关系数组（虚拟字段，不产生 SQL 列、不 ALTER 任何现有列）。
4. **禁止改动** [lib/storage/blob.ts](../../../lib/storage/blob.ts)（skill 包依赖其 `addRandomSuffix:false` 的稳定 key）；视频上传走独立的 `lib/video/blob.ts`。
5. **禁止**让视频字节经过 [app/api/storage/[...key]/route.ts](../../../app/api/storage) 代理（它把整文件读进内存、并按 `^skills/<slug>/` 做 skill 门禁），也不得把视频存到 `skills/` 前缀下。
6. 日后统一首页：[app/page.tsx](../../../app/page.tsx) 是**唯一**可同时引用两块的文件，且只能 `Promise.all([latestSkills(), latestVideos()])` 各拉读侧查询，不 join、不共享表、不跨板块 import 组件。
7. 限流复用同一 in-memory Map，但 key 用 `video-chat:*` / `vcomment:*` 前缀，绝不与 skill 的 `chat:*` / `skill-assist:*` 撞。

### 2.4 中间件

[middleware.ts](../../../middleware.ts) 已 `matcher: ['/manage/:path*']` 并对非 admin 重定向——`/manage/videos` **零改动**即被护住。

## 3. 数据模型

MVP = **9 张 `Video*` 表 + 4 个枚举 + 7 个 `User` 反向关系**，全部增量，FK 仅指向 `User`/`Video*`。命名与计数器风格对齐 `Skill`（单数 `*Count`、`@default(cuid())`、`deletedAt`、`@@index`）。

### 3.1 枚举

```prisma
enum VideoStatus      { draft processing published unlisted archived }
enum VideoVisibility  { public unlisted private }
enum VideoSourceType  { admin_curated user_uploaded external_embed }
enum VideoCommentStatus { visible hidden deleted }
```

### 3.2 模型

```prisma
model Video {
  id              String          @id @default(cuid())
  slug            String          @unique
  title           String
  summary         String          @default("")   // feed 卡片一句话文案（≠ AI 摘要）
  descriptionMd   String          @default("")    // 富文本描述，MarkdownRenderer 渲染

  // ── 媒体（自托管，@vercel/blob 客户端直传）──
  videoKey        String?         // 视频 blob key（lib/video/blob.ts，addRandomSuffix:true）
  videoUrl        String?         // 不可猜的 blob 公网 URL，<video> 直接 src
  posterKey       String?
  posterUrl       String?
  mimeType        String          @default("video/mp4")
  sizeBytes       Int             @default(0)
  width           Int?
  height          Int?
  durationSec     Int             @default(0)     // 前端 loadedmetadata 读出，免 ffprobe
  externalUrl     String?         // external_embed 用，phase-2

  // ── 状态 / 归类 ──
  status          VideoStatus     @default(draft)
  visibility      VideoVisibility @default(public)
  sourceType      VideoSourceType @default(admin_curated) // 预留口子：日后 user_uploaded 零改表
  uploaderId      String          // → User（v1=admin；日后=投稿者）
  categoryId      String?         // → VideoCategory（隔离，非 skill Category）
  language        String?         // BCP-47，feed 展示 + 可选 AI 语言 fallback
  featured        Boolean         @default(false)
  featuredAt      DateTime?
  publishedAt     DateTime?       // status→published 时写入；feed 主排序键

  // ── 访谈嘉宾（"AI 极客访谈"，全部可选）──
  intervieweeName      String?
  intervieweeTitle     String?
  intervieweeOrg       String?
  intervieweeBio       String?
  intervieweeAvatarKey String?
  guestUserId          String?    // → User?（嘉宾恰好是平台用户时）

  // ── 反范式化计数器（feed/详情零聚合查询）──
  viewCount       Int             @default(0)
  likeCount       Int             @default(0)
  commentCount    Int             @default(0)
  favoriteCount   Int             @default(0)
  trendingScore   Float           @default(0)     // 复用 lib/trending.ts 形态（phase-2 刷新）

  // ── AI（摘要缓存列；对话 MVP 无状态、不存表）──
  transcriptText    String?       // 管理员粘贴的文字稿，喂给摘要/对话
  aiSummaryMd       String?       // 缓存的 AI 摘要（Markdown），右栏直接渲染
  aiSummaryModel    String?       // 生成所用模型 id（溯源）
  aiSummaryAt       DateTime?
  aiSummarySourceHash String?     // 标题+描述+文字稿 的 hash，内容变更即失效重生

  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?       // 软删

  uploader  User          @relation("UploadedVideos", fields: [uploaderId], references: [id], onDelete: Cascade)
  guestUser User?         @relation("GuestVideos",    fields: [guestUserId], references: [id], onDelete: SetNull)
  category  VideoCategory? @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  tags      VideoTagOnVideo[]
  comments  VideoComment[]
  likes     VideoLike[]
  favorites VideoFavorite[]
  views     VideoView[]

  @@index([status, visibility])
  @@index([publishedAt])
  @@index([categoryId])
  @@index([uploaderId])
  @@index([featured, publishedAt])
  @@index([trendingScore])
  @@index([createdAt])
}
```

```prisma
model VideoCategory {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  description String?
  coverKey    String?
  parentId    String?
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  parent   VideoCategory?  @relation("VideoCategoryHierarchy", fields: [parentId], references: [id])
  children VideoCategory[] @relation("VideoCategoryHierarchy")
  videos   Video[]

  @@index([parentId])
  @@index([sortOrder])
}

model VideoTag {
  id         String           @id @default(cuid())
  slug       String           @unique
  name       String
  usageCount Int              @default(0)
  videos     VideoTagOnVideo[]

  @@index([usageCount])
}

model VideoTagOnVideo {
  videoId   String
  tagId     String
  createdAt DateTime @default(now())

  video Video    @relation(fields: [videoId], references: [id], onDelete: Cascade)
  tag   VideoTag @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([videoId, tagId])
  @@index([tagId])
}

model VideoComment {
  id        String             @id @default(cuid())
  videoId   String
  authorId  String
  parentId  String?            // 自关联盖楼（UI 一层，模型可深层）
  bodyMd    String
  status    VideoCommentStatus @default(visible)
  likeCount Int                @default(0)
  replyCount Int               @default(0)
  pinned    Boolean            @default(false)
  editedAt  DateTime?
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt

  video   Video          @relation(fields: [videoId], references: [id], onDelete: Cascade)
  author  User           @relation(fields: [authorId], references: [id], onDelete: Cascade)
  parent  VideoComment?  @relation("VideoCommentThread", fields: [parentId], references: [id], onDelete: Cascade)
  replies VideoComment[] @relation("VideoCommentThread")
  likes   VideoCommentLike[]

  // 注意：不设 @@unique([videoId, authorId])（与 Review 不同），一个用户可发多条
  @@index([videoId, createdAt])
  @@index([parentId])
}

model VideoCommentLike {
  userId    String
  commentId String
  createdAt DateTime @default(now())

  user    User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  comment VideoComment @relation(fields: [commentId], references: [id], onDelete: Cascade)

  @@id([userId, commentId])
  @@index([commentId])
}

model VideoLike {
  userId    String
  videoId   String
  createdAt DateTime @default(now())

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)

  @@id([userId, videoId])
  @@index([videoId])
}

model VideoFavorite {                          // = 收藏 / 稍后看
  userId    String
  videoId   String
  createdAt DateTime @default(now())

  user  User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)

  @@id([userId, videoId])
  @@index([videoId])
}

model VideoView {
  id          String   @id @default(cuid())
  videoId     String
  userId      String?
  sessionHash String   // sha256( (userId | ipHash) + videoId + UTC日 )，按天分桶去重
  createdAt   DateTime @default(now())

  video Video @relation(fields: [videoId], references: [id], onDelete: Cascade)
  user  User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@unique([videoId, sessionHash])             // 同一人同一天同一视频只计一次
  @@index([videoId])
}
```

### 3.3 User 反向关系（虚拟，无 SQL 列）

```prisma
// 追加到 model User 内：
uploadedVideos   Video[]            @relation("UploadedVideos")
guestVideos      Video[]            @relation("GuestVideos")
videoViews       VideoView[]
videoLikes       VideoLike[]
videoFavorites   VideoFavorite[]
videoComments    VideoComment[]
videoCommentLikes VideoCommentLike[]
```

### 3.4 迁移

- `pnpm prisma migrate dev --name add_videos_board`。
- **校验**：生成的 SQL 必须**只含** `CREATE TYPE` / `CREATE TABLE "Video..."` / `CREATE INDEX` / 指向 `User|Video*` 的 `ADD CONSTRAINT ... REFERENCES`。**一旦出现** `ALTER TABLE "Skill"/"Category"/"Tag"` 或任何 `DROP`，即说明 schema 改错了——停手回滚。
- 回滚 = 删除 `Video*` 对象 + 移除 `User` 的反向关系行。

### 3.5 已解决的设计冲突（来自研究阶段）

| 冲突 | 裁决 |
|---|---|
| 收藏模型命名 `VideoFavorite` vs `VideoSave` | **`VideoFavorite`**（对齐现有 `Favorite` 词汇；UI 文案仍可叫"收藏/稍后看"） |
| 计数器命名 复数 vs 单数 | **单数 `viewCount/likeCount/commentCount/favoriteCount`**（对齐 `Skill.*Count`，复用切换逻辑可逐字照搬） |
| 分类/标签 复用 `Category/Tag` vs 隔离 | **隔离 `VideoCategory/VideoTag`**（命名空间硬约束：`Video*` 只 FK 到 `User/Video*`） |
| AI 持久化 建 Chat/Job 表 vs 缓存列 | **MVP 仅 `Video` 上缓存摘要列 + 无状态对话**；`VideoChatSession/Message`、`VideoAiJob` 推迟 phase-2（仍增量） |
| `VideoView` 语义 续播态 vs 计数 | **按天分桶去重计数**；续播进度（`positionSec` 等）推迟 phase-2 |
| 路由标识 `[slug]` vs `[id]` | 公开路由统一 **`[slug]`**；后台 `/manage` 路由可用 `[id]` |

## 4. 路由与页面

### 4.1 页面（server component 为主）

| 路由 | 作用 | 权限 |
|---|---|---|
| `/videos` | feed：`?q=&category=&sort=&page=`；ILIKE 搜索（照搬 [app/manage/skills/page.tsx](../../../app/manage/skills) 写法） | 登录 |
| `/videos/[slug]` | 详情：左 `Player→Meta→描述→评论`，右 `AiPanel`，底 相关视频 | 登录；draft/private 对非 owner/admin 返回 `notFound()`（仿 skill 详情） |
| `/manage/videos` | 后台列表 | admin（middleware） |
| `/manage/videos/new` | 上传 + 录入文案 | admin |
| `/manage/videos/[id]/edit` | 编辑视频文字/元信息、重生成摘要 | admin |

### 4.2 API（均在 `app/api/videos/`）

| 方法 & 路径 | 权限 | 作用 |
|---|---|---|
| `GET /api/videos` | 登录 | 列表/搜索（小 JSON） |
| `POST /api/videos` | admin | 客户端直传完成后建库（小 JSON 元数据） |
| `POST /api/videos/blob-upload` | admin | `@vercel/blob` `handleUpload` token 路由 |
| `POST /api/videos/[slug]/view` | 登录 | 去重计数 |
| `POST /api/videos/[slug]/like` | 登录 | 点赞 toggle（照搬 skill like 的 `$transaction`） |
| `POST /api/videos/[slug]/favorite` | 登录 | 收藏 toggle |
| `GET/POST /api/videos/[slug]/comments` | GET 登录 / POST 登录 | 列表（游标分页）/ 发评论 |
| `PATCH/DELETE /api/videos/[slug]/comments/[id]` | 本人或 admin | 编辑 / 软删 |
| `POST /api/videos/[slug]/comments/[id]/like` | 登录 | 评论点赞 toggle |
| `GET/POST /api/videos/[slug]/summary` | GET 登录 / POST admin | 取/懒生成摘要 / admin 强制重生成 |
| `POST /api/videos/[slug]/chat` | 登录 | AI 对话（流式 SSE） |

## 5. 上传 / 存储 / 播放

### 5.1 上传（绕开 6mb 墙）

[next.config.mjs](../../../next.config.mjs) 的 `serverActions.bodySizeLimit='6mb'` 对视频远远不够。**必须用 `@vercel/blob` 客户端直传**（`@vercel/blob@0.27.3` 已导出 `./client` 子路径，已验证）：

1. `VideoUploadForm`（client）调 `upload(pathname, file, { access:'public', handleUploadUrl:'/api/videos/blob-upload', clientPayload, onUploadProgress })` 传 MP4，再传封面图。
2. `/api/videos/blob-upload` 跑 `handleUpload`，`onBeforeGenerateToken` 内**校验 admin**（`auth()` 读转发 cookie；非 admin 抛错 → 不发 token）、限 `allowedContentTypes`（视频 `['video/mp4']`，封面 `image/*`）、限 `maximumSizeInBytes`。
3. 浏览器拿到 `blob.url + pathname`。
4. 表单 `POST /api/videos` 提交小 JSON 元数据建库。
5. 时长由前端 `<video>.loadedmetadata` 的 `videoEl.duration` 读出存 `durationSec`，免 ffprobe。

> 视频上传**绕过 `lib/storage`**，在 `lib/video/blob.ts` 内独立设 `addRandomSuffix:true`，得到不可猜的"能力 URL"。

### 5.2 播放与流式

- `components/video/VideoPlayer.tsx`（`'use client'`）：原生 `<video controls preload="metadata" playsInline poster={posterUrl}><source src={videoUrl} type="video/mp4"/></video>`。直接吃 Blob URL → **天然 HTTP Range/拖动**，无需自写 range handler。
- **绝不代理字节**：已确认 [lib/storage/local.ts](../../../lib/storage) 的 `storage.get` 把整对象读进 Buffer、[app/api/storage/[...key]/route.ts](../../../app/api/storage) 一次性返回——对 ~5MB zip 没问题，对视频是致命的（每个观看者整文件进内存、毁掉 Range/拖动、拖垮函数）。

### 5.3 访问控制（MVP）

- 全站登录墙（见 §7）。视频 URL 仅在服务端判定"已授权"后才渲染给前端；未授权只给封面 + 登录墙，前端永远拿不到 URL。
- 不可猜的能力 URL（`addRandomSuffix:true`）作为 MVP 的事实门禁；按请求签发的短时签名 URL + 私有 Blob 推迟 phase-2。

### 5.4 搜索（MVP）

Prisma `contains + mode:'insensitive'`（ILIKE）匹配 `title/descriptionMd`，叠加 `status=published`、`deletedAt:null`、可见性过滤——即 [app/manage/skills/page.tsx](../../../app/manage/skills) 的现成写法。Postgres 全文/`pg_trgm` 排序推迟 phase-2。

## 6. AI 摘要与对话

### 6.1 后端

全程复用 [lib/llm](../../../lib/llm) 的 `getProvider()`（供应商无关、env 切换；默认 `AnthropicProvider` + `claude-haiku-4-5-20251001`，已验证 `lib/llm/config.ts:7`）。**不新增任何 SDK/provider/model 接线**。摘要用 `complete()` 一次性；对话用 `streamDeltas() + toSseResponseStream()`——与现有 skill chat 路由同源。

### 6.2 纯函数 `lib/video/ai.ts`（仿 `lib/skill-context.ts`，无 DB/env/LLM 依赖）

- `buildVideoContext({ title, description, transcript, tags, maxChars≈120KB })`：按**固定顺序** `TITLE→DESCRIPTION→TRANSCRIPT` 拼装，使可缓存前缀字节稳定。
- `buildVideoSummaryPrompt(context) → { system, user, maxTokens }`。
- `buildVideoChatSystem(context, summary)`：上下文 + 摘要 + 护栏（"只答本视频涉及内容，没讲到就说不知道"）。
- `videoContextSourceHash({ title, description, transcript })`：内容变更即令缓存摘要失效。
- `parseVideoSummary(text)`：裁剪/夹断。

DB 读、`getProvider()`/`LLMConfigError` 处理、`rateLimit` 都放在**路由**层，不进 lib（与 skill 路由相同的分层）。

### 6.3 摘要（缓存在 `Video` 列，MVP 无额外表）

- 触发：(a) admin 的"生成/重新生成"按钮；(b) 首次详情 GET 且 `aiSummaryMd` 空、且有描述/文字稿时懒生成；(c) `aiSummarySourceHash` 失效重生。
- `GET …/summary` 返回缓存或懒生成并持久化；`POST …/summary`（admin）用 `provider.complete()` 强制重生成。
- 懒写用 `sourceHash + 乐观单飞`守护（仅当仍为 null/陈旧才写），避免并发首访重复生成。

### 6.4 对话（MVP 无状态）

- `POST …/chat`：zod 校验 `messages`（min1 max40，content max8000，可选 model）、`rateLimit`（登录 60/时、匿名不适用——见 §7）、`buildVideoChatSystem` 组 system、`provider.streamDeltas` 包进 `toSseResponseStream`，返回 `text/event-stream`（`cache-control: no-cache,no-transform`，`export const dynamic='force-dynamic'`）。
- **前端直接复用现成的 [app/skills/[slug]/streamChat.ts](../../../app/skills/[slug])**（归一化帧格式 `data:{delta}` / `data:{error}` / `[DONE]` 两端一致，已验证）。不写任何会话/消息表。

### 6.5 缓存与现实

- Anthropic prompt caching 已在 [lib/llm/anthropic.ts](../../../lib/llm) 接好（system 作 `[{type:'text',text,cache_control:ephemeral}]`）。把整段视频上下文放 system，可跨轮、跨不同用户对同一视频的对话命中缓存。OpenAI 路径优雅忽略 `cache_control`，不报错。
- **AI 的"知识"完全来自管理员录入的描述/文字稿**（v1 手动粘贴；真·ASR 转写 phase-2）。模型不"看"视频；靠护栏在未覆盖时回答"本视频未涉及"。

### 6.6 输出语言

AI 摘要/对话的输出语言**跟界面语言走**（next-intl locale，zh-CN / en）。`Video.language` 仅作展示与 phase-2 fallback。

## 7. 访问控制（全站登录墙）

- **未登录看不到 feed**，与内部社区调性一致；浏览/封面/播放/AI/评论全部要求登录。
- 写操作（评论/点赞/收藏/AI 对话）未登录返回 401，前端走登录跳转 helper。
- admin-only：后台 CRUD、`blob-upload` token、摘要强制重生成。
- `draft/private/unlisted` 视频对非 owner/非 admin 一律 `notFound()`（隐藏存在性，仿 [app/skills/[slug]/page.tsx](../../../app/skills/[slug])）。
- **匿名 AI 对话：不允许**（必须登录）。

视频侧访问判定全部走独立的 `lib/video/access.ts`（纯模块），**不碰** `lib/access.ts`。

## 8. 前端组件树

| 组件 | 位置 | 作用 |
|---|---|---|
| `VideoCard` | components/video/ | feed 卡片（封面/时长/标题/作者/计数） |
| `VideoGrid` | components/video/ | 网格容器 |
| `CategoryBar` | components/video/ | 分类筛选条（`?category=`） |
| `VideoPlayer` | components/video/ | 原生播放器 + 首次真实播放后 `POST /view`（ref 守护，非挂载即计） |
| `VideoMeta` | components/video/ | 标题/作者/嘉宾/计数/互动栏 |
| `VideoEngagementBar` | components/video/ | 点赞/收藏/分享（乐观切换 + 回滚 + 401→登录；改编自 skill `ActionButtons`，去掉订阅/remix） |
| `AiPanel` | components/video/ | 右栏壳：`AiSummary` + `AiChat` |
| `AiSummary` | components/video/ | 渲染缓存摘要（Markdown） |
| `AiChat` | components/video/ | 复用 `streamChat.ts` 的流式问答 |
| `CommentSection`/`CommentThread`/`CommentItem`/`CommentComposer` | components/video/ | 盖楼评论 |
| `RelatedVideos` | components/video/ | 同分类 + 时间近邻 |
| 复用 | components/ | `SearchBar`、`SortMenu`、`MarkdownRenderer`、`EmptyState`、`Toaster` |

后台沿用 [app/manage/manage.css](../../../app/manage) 的 `.manage-shell` 体系。

## 9. 评论与互动（细则）

- **盖楼一层**（`parentId`，UI 一级回复，模型可深层）；`bodyMd` 存好，v1 以 `whitespace-pre-wrap` 纯文本渲染（同 ReviewsTab），MarkdownRenderer 留 phase-2。
- 列表：`GET …/comments`（`sort=top|newest`，keyset 游标，默认 20 上限 50，回复不内联、惰性"查看 N 条回复"）。
- 发评论：`POST …/comments`（登录、zod `bodyMd` max 2000、可选 `parentId` 校验属同视频且为顶层、`rateLimit` key `vcomment:user:{id}` ~10/分、`$transaction` 同步 `Video.commentCount` 与父 `replyCount`）。模板 = [app/api/skills/[slug]/reviews/route.ts](../../../app/api/skills/[slug]/reviews) 泛化为"可盖楼+分页+去掉每人一条限制"。
- 编辑：`PATCH`（仅本人，置 `editedAt`）。删除：`DELETE`（本人或 admin；有回复则软删为 `deleted` 墓碑，无回复硬删；admin 删调 `logAdmin('video_comment_delete')`）。
- 评论点赞：`POST …/comments/[id]/like`，`VideoCommentLike` 在 `$transaction` 内 toggle 并同步 `likeCount`（逐字照搬 skill like 路由）。
- **审核（v1）**：即时发布 + 墓碑软删 + admin 覆盖删除；无预审队列、无举报、无 LLM 毒性过滤。删/隐藏后读取只返回墓碑，绝不返回原文。

## 10. i18n

- 全部视频 UI 文案走 `useTranslations`/`getTranslations`，新增 `video.*` namespace 到 **`messages/zh-CN.json` 与 `messages/en.json` 两个文件**（增量 key，**不得删/改现有 key**——任一文件缺 key 会在渲染时抛错）。
- 禁止硬编码中文串。

## 11. 不在本期范围（YAGNI / phase-2，均为增量）

- `VideoChatSession`/`VideoChatMessage`（对话历史/分析）、`VideoAiJob`（异步摘要/转写任务）。
- 续播进度 / 观看历史（给 `VideoView` 加 `positionSec/watchedSec` 或独立表）。
- ASR 自动转写 + 字幕 `<track>` + 章节喂 AI。
- 按请求签名/过期播放 URL + 私有 Blob（真·字节级鉴权）。
- HLS/ABR + ffmpeg 转码 + 悬停预览雪碧图 + 自动抽帧封面。
- 全文/trigram 搜索排序 + 向量相关推荐。
- 开放 UGC（把 `blob-token`/`POST /api/videos` 从 admin-only 放开为 `canPublish` + 审核队列，仿 `SkillStatus`）。
- 更深评论（无限嵌套、@提及、置顶 UI、举报、编辑历史）、通知/订阅/播放列表、实时评论。
- 可续传分片上传（超大文件）。
- `external_embed`（YouTube 等）播放路径（保留枚举值与 `externalUrl` 列，不建实现）。
- trending 刷新任务（复用 [scripts/refresh-trending.ts](../../../scripts) + [lib/trending.ts](../../../lib/trending.ts) 形态；`Video.trendingScore` 已就位）。

## 12. 已知 gap（MVP 取舍，留档）

- 无回复/点赞通知、无新评论邮件（YouTube 有）。
- 无续播/继续观看。
- 无字幕/无障碍 `<track>`。
- 相关视频仅同分类+时间，弱。
- ILIKE 无相关性排序/容错。
- `VideoView` 去重 + in-memory 限流均单实例；多节点部署时计数/限流按实例泄漏（与 skills 现有限制一致）。
- 单 MP4、无 ABR/HLS：弱网/超大文件缓冲体验差、无清晰度选择。

## 13. 需用户/运维确认的外部前提

1. **LLM 后端可达性**：内网能否实际访问 LLM 端点（`api.anthropic.com` 或内网 OpenAI 兼容 `LLM_BASE_URL`）、用哪个模型。skill chat 已假定其可用，视频沿用同一套。
2. **文字稿来源**：v1 用管理员**粘贴** `transcriptText`（无 ASR）。无文字稿时摘要/对话会偏弱/泛化——确认可接受。
3. **存储/带宽预算**：Vercel Blob 的单视频上限与总容量/带宽预算，决定 `maximumSizeInBytes` 与是否提前需要分片续传。

> 已拍板：浏览=全站登录墙；评论=即时发布+admin 事后软删；AI 输出语言=跟界面语言；匿名 AI 对话=不允许。

## 14. 验收标准

1. `pnpm prisma migrate dev --name add_videos_board` 生成的 SQL 仅含 `Video*` 的 `CREATE` 与指向 `User/Video*` 的外键；无任何 `ALTER TABLE "Skill"/"Category"/"Tag"` 或 `DROP`。`pnpm build` 全部路由编译通过。
2. skills 板块所有页面/API/CLI 行为不变（无 `lib/access.ts`、`lib/storage/blob.ts`、`app/api/storage`、现有 i18n key 的改动）。
3. admin 能在 `/manage/videos` 客户端直传 MP4（绕开 6mb）、传封面、录入文案与文字稿、发布；`/videos` feed 能搜索/分类/分页；`/videos/[slug]` 能原生播放并支持拖动。
4. 详情右栏：AI 摘要可生成并缓存、可 admin 重生成；AI 对话流式可用（复用 `streamChat.ts`）；二者输出语言跟界面语言；未登录均不可用。
5. 评论可发/盖楼回复/点赞/排序/分页/编辑/删除（本人）/admin 软删（审计入 `AdminLog`，`targetType:'Video'/'VideoComment'`）；计数器与 `Video.*Count` 同步。
6. 全站登录墙：未登录看不到 feed；写操作 401 跳登录；draft/private 对非 owner/admin 404。
7. 仅改 `LLM_*` 环境变量即可把视频 AI 切到非 Anthropic（OpenAI 兼容）模型，零代码改动。
