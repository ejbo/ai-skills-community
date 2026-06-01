# Skill 详情页与 Try It AI 增强 — 设计文档

- 日期：2026-06-01
- 状态：已批准（用户口头批准设计，进入实现）
- 范围：skill 详情页（Overview / 新增 Files tab）+ Try It（保留并排对比、新增流式对话）+ 喂给 AI 的完整 skill 上下文 + 文件入库的数据层

## 1. 背景与问题

当前 skill 详情页 [app/skills/[slug]/page.tsx](../../../app/skills/[slug]/page.tsx) 有 5 个 tab：`overview / versions / reviews / composition / try_it`。存在三个问题：

1. **Overview 显示的是 SKILL.md 正文本身**。上传 bundle 时 [app/api/skills/upload-package/route.ts](../../../app/api/skills/upload-package/route.ts) 把 SKILL.md 去掉 frontmatter 的正文写进了 `Skill.descriptionMd`，而 Overview 渲染 `descriptionMd`。Overview 应该是作者写的使用指南（README 式），而非 skill 本体。
2. **无法浏览 skill 的文件结构**。bundle 上传后只把整包 ZIP 存进 blob 存储，DB 仅保存 `fileCount`/`totalBytes` 聚合数字；文件列表和单文件内容都没存，所以做不了 GitHub 式文件浏览。
3. **Try It 的 AI 看不到完整 skill**。[app/api/skills/[slug]/try/route.ts](../../../app/api/skills/[slug]/try/route.ts) 只把 `contentInline ?? descriptionMd`（即 SKILL.md 正文）喂给 AI，看不到 bundle 里的其它文件。并排对比里"不装（baseline）"列故意不加载 skill —— 当用户问"这个 skill 怎么用"时 baseline 自然回答"读不到 skill"，看起来像 bug。缺少一个明确"已加载 skill"的对话功能。

## 2. 目标

- Overview 改为展示作者使用指南（优先 bundle 内 README.md，回退 summary）。
- 新增 Files tab：GitHub 式，左侧文件树、右侧文件内容。
- Try It 的"装上 skill"侧与新对话功能都能看到**完整 skill**（SKILL.md + 全部文本文件）。
- Try It 保留并排对比，新增流式（SSE）多轮对话。
- 数据层：上传时把文件树 + 文本文件内容入库；对存量数据回填。

## 3. 关键决策（已与用户确认）

| 决策 | 选择 |
| --- | --- |
| 文件列表/内容来源 | **上传时存入数据库**（新增 `SkillFile` 表），并对存量懒回填 |
| Overview 内容来源 | **优先 bundle 内 README.md**，否则 summary；structured 用作者写的 descriptionMd |
| Try It 结构 | **保留并排对比 + 新增对话**，顶部模式切换 |
| 对话实现 | **流式 SSE**，多轮 |
| Overview 修法 | 改"`descriptionMd` 里装什么"（上传/回填层），前端基本不变；不新增字段 |
| Files tab v1 | 先不做语法高亮（`<pre>` + markdown 渲染） |
| 对话默认模型 | haiku（便宜），后续可加模型切换 |

## 4. 数据层设计

### 4.1 新模型 `SkillFile`

```prisma
model SkillFile {
  id        String  @id @default(cuid())
  versionId String
  path      String   // "SKILL.md" / "references/foo.md" / "scripts/run.py"
  size      Int      // 解压后字节数
  isText    Boolean @default(true)
  content   String?  // 文本内容；二进制或超大为 null
  truncated Boolean @default(false)
  version   SkillVersion @relation(fields: [versionId], references: [id], onDelete: Cascade)
  @@unique([versionId, path])
  @@index([versionId])
}
```

`SkillVersion` 增加 `files SkillFile[]` 反向关系。需要一次 `prisma migrate`。

### 4.2 解析层（lib/skill-parser.ts）

`parseSkillBundle` 扩展：对每个条目除记录 `{path,size}` 外，读取文本文件内容。
- 二进制判定：按扩展名白名单（`.md .txt .py .ts .js .json .yaml .yml .sh .toml .csv .html .css .tsx .jsx .mjs .cjs .rb .go .rs .java .sql .env .gitignore` 等，及无扩展名的纯文本探测）+ 内容空字节探测；二进制 `isText=false, content=null`。
- 单文件上限 `MAX_FILE_BYTES = 256 * 1024`，超限 `content` 截断到上限并 `truncated=true`。
- 返回结构扩展为 `files: Array<{ path; size; isText; content: string | null; truncated: boolean }>`。

### 4.3 写入（upload-package/route.ts）

在创建 `SkillVersion` 的同一事务里 `createMany` 写入 `SkillFile` 行。
同时修正 `descriptionMd`：
- 若 bundle 内存在 README.md（忽略大小写、取顶层优先）→ `descriptionMd = README 内容`；
- 否则 `descriptionMd = summary`。
- **不再把 SKILL.md 正文写进 `descriptionMd`**；`contentInline` 仍保留 SKILL.md 正文（raw 路由 / CLI / AI 需要）。

### 4.4 存量回填

- 脚本 `scripts/backfill-skill-files.ts`：遍历 bundle 版本，下载 `storageUrl` 的 ZIP，重解析，`createMany` 写入 `SkillFile`；并按 4.3 规则修正对应 `Skill.descriptionMd`（仅 bundle，structured 不动）。
- **懒回填**：文件 API 读取时，若某 bundle 版本有 `storageUrl` 但无 `SkillFile` 行，则即时解压入库后再返回。脚本与懒回填二者其一即可，互不冲突。
- structured skill（无 ZIP）：不入库，文件 API 即时合成单个 SKILL.md（frontmatter + contentInline）。

## 5. Files tab

### 5.1 后端

- `GET /api/skills/[slug]/files` → 文件树（轻量，仅 `{ path, size, isText }[]`，不含内容）。bundle 触发懒回填；structured 返回单个合成 SKILL.md 条目。
- `GET /api/skills/[slug]/files/content?path=<path>` → 单文件内容。校验 path 在该版本文件列表内（防穿越）；二进制/超大只返回元数据（`isText:false` 或 `truncated:true`）。

### 5.2 前端 `app/skills/[slug]/FilesTab.tsx`（client）

- 由扁平 path 列表构建嵌套文件树，文件夹可折叠（默认展开顶层）。
- 右侧内容区：`.md` 用现有 [components/MarkdownRenderer.tsx](../../../components/MarkdownRenderer.tsx)；其它文本用等宽 `<pre>`；二进制/超大显示大小 + 提示 + raw 下载链接。
- 默认选中 SKILL.md（无则 README.md，再无则第一个文件）。
- 选中文件时按需拉 `/files/content`。

## 6. Overview

- 前端 [page.tsx](../../../app/skills/[slug]/page.tsx) overview 仍渲染 `skill.descriptionMd || skill.summary`，新增"作者未提供使用指南"空状态。
- 内容正确性由数据层（4.3 / 4.4）保证：bundle 的 `descriptionMd` 现在是 README/summary 而非 SKILL.md。

## 7. AI 上下文：`buildSkillContext`

新增 `lib/skill-files.ts`（或 `lib/skill-context.ts`）导出 `buildSkillContext(slug)`：
- 组装：skill 名 + summary + 完整 SKILL.md 正文 + 各文本支撑文件（带 path）。
- 顺序：SKILL.md 优先，再 `references/`，再其它。
- 总量预算 `MAX_CONTEXT_BYTES ≈ 150KB`：超出则截断并在末尾列出被省略的文件路径。
- 返回适合做 Anthropic `system` 的字符串/块；调用方用 `cache_control: { type: 'ephemeral' }` 标记该 system 块以启用 prompt caching。

格式示意：
```
You have the following skill installed. Its files are provided below. Use it when relevant, and answer questions about how to use it.

--- SKILL: <name> ---
<SKILL.md 正文>

--- FILE: references/foo.md ---
<内容>
...
(omitted: scripts/big.bin, ...)
--- END SKILL ---
```

## 8. Try It：对比 + 对话

### 8.1 并排对比（改造现有）

- `try/route.ts` 的"装上 skill"侧改用 `buildSkillContext`（带缓存）；baseline 仍空（对比本意）。
- [TryItTab.tsx](../../../app/skills/[slug]/TryItTab.tsx) baseline 列下加说明："基线：故意不加载 skill，用于对比"，消除"读不到 skill"的误解。
- 顶部加模式切换「并排对比」/「对话」。

### 8.2 对话（新增，流式）

- `POST /api/skills/[slug]/chat`：SSE。body `{ messages: {role,content}[] }`；system 用 `buildSkillContext`（缓存）；Anthropic `stream:true`，把 `content_block_delta`/`text_delta` 转成简化 SSE 事件（`{type:'text',text}` / `done` / `error`）转发；复用 `lib/rate-limit` 按消息计数（key 用 `chat:`）。
- `app/skills/[slug]/ChatPanel.tsx`（client）：消息气泡列表 + 输入框；读 SSE 增量追加到进行中的 assistant 消息；多轮历史存组件 state；assistant 用 markdown 渲染；提供起手 prompt（"这个 skill 怎么用？""举个例子""它依赖什么？"）。

## 9. 错误处理

- 无 `ANTHROPIC_API_KEY` → 503。
- skill 未发布 / 不存在 / 无 currentVersion → 404。
- 文件 path 不在列表 → 404；二进制/超大 → 只返回元数据，不返回内容。
- 上游 Anthropic 报错 → 流内 `error` 事件 / 非流式 502。
- 上下文超预算 → 截断 + 列出省略项。

## 10. 测试

- 单元：parser 文件抽取（文本/二进制/截断）、文件树构建、`buildSkillContext` 预算与截断、README 选取。
- API：files 列表 + content（path 校验、懒回填、structured 合成）；chat SSE happy path + 限流 + 404。
- 组件：FilesTab 展开/选择/默认选中；ChatPanel 流式追加与多轮。
- 构建：`pnpm build` 全部路由编译通过。

## 11. 影响文件清单

新增：
- `prisma/schema.prisma`（SkillFile 模型 + 迁移）
- `lib/skill-files.ts` / `lib/skill-context.ts`（文件树、单文件、README、buildSkillContext）
- `app/api/skills/[slug]/files/route.ts`
- `app/api/skills/[slug]/files/content/route.ts`
- `app/api/skills/[slug]/chat/route.ts`
- `app/skills/[slug]/FilesTab.tsx`
- `app/skills/[slug]/ChatPanel.tsx`
- `scripts/backfill-skill-files.ts`

修改：
- `lib/skill-parser.ts`（抽取文件内容）
- `app/api/skills/upload-package/route.ts`（写 SkillFile、修正 descriptionMd）
- `app/api/skills/[slug]/try/route.ts`（用 buildSkillContext）
- `app/skills/[slug]/DetailTabs.tsx`（新增 files tab + i18n）
- `app/skills/[slug]/page.tsx`（渲染 FilesTab、overview 空状态）
- `app/skills/[slug]/TryItTab.tsx`（模式切换、挂 ChatPanel、baseline 说明）
- i18n 文案（tab 标签、对话/文件相关字符串）

## 12. 非目标（YAGNI）

- 代码语法高亮（v1 用 `<pre>`）。
- 对话历史持久化（先存组件 state）。
- 文件编辑 / 在线修改。
- 多模型切换 UI（默认 haiku）。
