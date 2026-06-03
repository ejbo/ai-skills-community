# 技能对比（Skill Comparison）功能 — 设计文档

- **日期**: 2026-06-02
- **分支**: feat/skill-visibility-access
- **状态**: 已通过设计评审，待落实施计划

## 1. 背景与动机

当前技能详情页的 **Try It** tab 有两种模式：

- **Compare 模式** — 访客输入一个 prompt，服务端并行调用两次 Claude（带 skill 上下文 / 不带），并排展示差异。见 [app/api/skills/[slug]/try/route.ts](../../../app/api/skills/[slug]/try/route.ts) 与 [app/skills/[slug]/TryItTab.tsx](../../../app/skills/[slug]/TryItTab.tsx)。
- **Chat 模式** — 多轮流式对话，模型始终带着 skill 上下文。见 [app/api/skills/[slug]/chat/route.ts](../../../app/api/skills/[slug]/chat/route.ts) 与 [app/skills/[slug]/ChatPanel.tsx](../../../app/skills/[slug]/ChatPanel.tsx)。

**问题**：访客侧的实时对比价值有限——每次访问烧 2 次 API，且「不装 skill」常常约等于「什么都没装」，原始双跑差异往往不明显，访客看不出 skill 的价值。

**目标**：

1. 把对比从"访客实时跑"改为"**作者预先生成、可编辑、已发布的静态制品**"，访客侧零 API 调用。
2. 对比内容不再是两段裸输出，而是**模型结合两次真实运行结果 + 对 skill 的分析，写出的结构化对比报告**。
3. 让模型/供应商**易于切换**（作者日后可能不用 Claude），改环境变量即可换模型/换供应商，零代码改动。

## 2. 改动总览

| 维度 | 现状 | 改后 |
|---|---|---|
| **Try It tab** | Compare / Chat 双模式切换 | 只留 Chat（删掉实时对比 + 切换按钮） |
| **对比** | 访客实时双跑 | 新「对比」tab：展示作者预先生成、已发布的静态对比 |
| **生成时机** | 访问时 | 作者上传/编辑时，在「对比工坊」里生成 |
| **模型配置** | 写死 `claude-haiku-4-5`，直连 `api.anthropic.com` | `lib/llm` 供应商无关层，改 env 即可切换 |

旧 `/api/skills/[slug]/try` 的双跑逻辑不删，而是搬到作者侧（对比工坊的"实测"步骤）复用。`/api/skills/[slug]/try` 路由本身在迁移完成后删除。

## 3. 数据模型

新增 `SkillComparison` 模型，**一行 per skill**（`skillId` 唯一）。

```prisma
model SkillComparison {
  id                    String   @id @default(cuid())
  skillId               String   @unique
  skill                 Skill    @relation(fields: [skillId], references: [id], onDelete: Cascade)
  status                String   @default("draft")   // draft | published
  bodyMd                String?  @db.Text             // 结构化分析报告（访客看的正文）
  example               Json?                          // { taskPrompt, withOutput, withoutOutput } 真实双跑结果
  guidancePrompt        String?  @db.Text             // 作者的定向 prompt（便于重生成）
  model                 String?                        // 生成时用的模型 id
  generatedForVersionId String?                        // 生成时针对的版本（做陈旧提示）
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  @@index([skillId])
}
```

- 在 `Skill` 模型上加反向关系 `comparison SkillComparison?`。
- 新迁移命名 `YYYYMMDDHHMM_add_skill_comparison`，通过 `pnpm db:migrate` 生成。
- `example` 用 JSON 列存一组真实双跑结果（v1 仅支持单组样例；多样例留作后续）。

**取舍**：per-skill 一行（已选，简单）vs per-version（更"正确"但多版本时需重生成、增复杂度）。选 per-skill；用 `generatedForVersionId` 与 `skill.currentVersion` 比对，在内容更新后给作者"要不要重新生成"的提示。

## 4. 模型 / 供应商抽象层 `lib/llm`

新建模块，把所有 LLM 调用收敛到一个供应商无关接口。

```
lib/llm/
  types.ts     // LLMProvider 接口与消息/结果类型
  anthropic.ts // Anthropic 适配器（保留现有 prompt caching 行为）
  openai.ts    // OpenAI 兼容适配器（Chat Completions；system 作首条 message；base URL 可配）
  index.ts     // getProvider(): 读 env 返回 provider + 默认 model
```

**接口草案**（`types.ts`）：

```ts
export interface LLMMessage { role: 'user' | 'assistant'; content: string }
export interface LLMCompleteOptions {
  system?: string;              // 拼好的系统提示（skill 上下文等）
  messages: LLMMessage[];
  maxTokens?: number;           // 默认 1024
  model?: string;               // 不传则用 provider 默认
  stream?: boolean;
}
export interface LLMUsage { input: number; output: number }
export interface LLMProvider {
  readonly defaultModel: string;
  complete(opts: LLMCompleteOptions & { stream?: false }):
    Promise<{ text: string; usage: LLMUsage | null }>;
  stream(opts: LLMCompleteOptions):
    AsyncIterable<{ delta: string }>;   // 归一化的文本增量
}
```

**环境变量**（扩展 [lib/env.ts](../../../lib/env.ts) 的 zod schema）：

```
LLM_PROVIDER   = anthropic | openai-compatible    # 默认 anthropic
LLM_BASE_URL   = https://your-gateway/v1          # openai-compatible 用
LLM_API_KEY    = ...                              # 通用 key（缺省回退 ANTHROPIC_API_KEY）
LLM_MODEL      = qwen-max / deepseek-chat / claude-haiku-4-5 ...
```

- 保留 `ANTHROPIC_API_KEY` 向后兼容：`anthropic` provider 在 `LLM_API_KEY` 未设时回退到它。
- 切模型/换供应商**只改 env，零代码改动**。覆盖大多数国产/内网网关（通义、DeepSeek、盘古、vLLM 等走 OpenAI 兼容形态）。
- Anthropic 适配器保留 `cache_control: { type: 'ephemeral' }` 的 prompt caching；OpenAI 兼容适配器无此概念，忽略即可。

**流式归一化**：当前 [chat/route.ts](../../../app/api/skills/[slug]/chat/route.ts) 直接把 Anthropic 的 SSE 原样透传给前端，[ChatPanel.tsx](../../../app/skills/[slug]/ChatPanel.tsx) 按 Anthropic 事件格式解析。为做到供应商无关：

- 适配器内部解析各自上游 SSE，对外 `yield { delta }`。
- 路由把增量重新编码为统一的 `data: {"delta": "..."}\n\n` SSE。
- 小改 ChatPanel 的解析逻辑，按统一格式读取（不再绑定 Anthropic 事件名）。

## 5. 对比生成流程（对比工坊，owner/admin only）

实现"几轮对话 → 采用 → 编辑 → 发布"，拆成两段，把"贵的真实跑"与"便宜的迭代"分开。

### 5.1 第一段 · 真实双跑（每个样例只跑一次，贵）

作者填一个**样例任务 prompt** → 点「实测」→ `POST /api/skills/[slug]/comparison/baseline`：

- 跑 1：`system = 该 skill 上下文`（复用 [lib/skill-files.ts](../../../lib/skill-files.ts) 的 `buildContextFromSkill`）→ 真实「装上」输出。
- 跑 2：无 system → 真实「不装（baseline）」输出。
- 通过 `lib/llm` 并行执行，返回 `{ taskPrompt, withOutput, withoutOutput }`。

### 5.2 第二段 · 分析对话（便宜，可几轮迭代）

工坊形似聊天：`POST /api/skills/[slug]/comparison/workshop`，请求体 `{ messages, baseline }`。

- system 注入 = `skill 内容 + 第一段两段真实输出 + 结构化模板要求`。
- 作者第一条消息 = 定向 prompt（可改），模型产出**结构化分析报告**：结合两次真实结果 + 对 skill 的分析，写出装/不装的差异，而非裸摆两段原文。
- 作者可继续追问微调（"Before/After 那段再具体点"）。每条 AI 回复都可被采用。
- 流式输出（走 `lib/llm` 归一化 SSE）。

### 5.3 采用 → 编辑 → 发布

- 作者对任意一条 AI 回复点「用作对比」→ 内容载入 **Markdown 编辑器**。
- 微调后 `PUT /api/skills/[slug]/comparison`，持久化 `bodyMd + example + guidancePrompt + model + status`。
- 操作：`保存草稿`（status=draft）/ `发布`（status=published）。
- 之后随时再进工坊编辑修改。

**状态说明**：工坊的多轮聊天记录是**前端临时草稿**，不入库；只有"采用并保存"后的正文 + 参数入库，保持简单。

**取舍**：完整自由聊天 vs「真实双跑一次 + 聊天精炼」。选后者：真实可信、迭代便宜。

## 6. API 路由

所有作者侧端点 owner/admin only（复用 [lib/access.ts](../../../lib/access.ts) 的 `loadAccessContext`，`decision.kind === 'owner' | 'admin'`）。

| 方法 & 路径 | 权限 | 作用 |
|---|---|---|
| `POST /api/skills/[slug]/comparison/baseline` | owner/admin | 真实双跑，返回 `{ taskPrompt, withOutput, withoutOutput }` |
| `POST /api/skills/[slug]/comparison/workshop` | owner/admin | 分析对话（流式 SSE），入参含 baseline + messages |
| `PUT  /api/skills/[slug]/comparison` | owner/admin | 保存/发布对比（bodyMd、example、guidancePrompt、model、status） |
| `GET  /api/skills/[slug]/comparison` | 访客（受 visibility 约束） | 取已发布对比；owner 额外可取草稿 |
| `DELETE /api/skills/[slug]/comparison` | owner/admin | 删除/撤回对比（可选） |

- 复用现有限流 [lib/rate-limit.ts](../../../lib/rate-limit.ts)，对 `baseline`/`workshop` 加 owner 维度限流。
- 草稿/published 状态判定一律放路由层，前端不做权限判断。

## 7. 访问控制

- 对比制品受 skill `visibility` 约束，与现有内容门禁一致（[lib/access.ts](../../../lib/access.ts)）：
  - `public` — 已发布对比对所有登录用户可见。
  - `restricted` — 需 `canContent`（已批准的 `SkillAccessRequest`）才能看对比正文，与下载/内容门禁同源。
  - `private` — 仅 owner/admin。
- 草稿对比仅 owner/admin 可见。
- 未发布 skill（draft/archived）的对比仅 owner/admin 可见。

## 8. 前端

### 8.1 移除 Try It 的 Compare

- [TryItTab.tsx](../../../app/skills/[slug]/TryItTab.tsx)：删除 `mode` state、切换按钮、`ResponseColumn` 与 compare 表单，直接渲染 `<ChatPanel slug={slug} />`。
- 清理只服务于 compare 的 i18n key（`detail.chat.compare_mode` 等按需保留/删除）。

### 8.2 新「对比」tab

- [DetailTabs.tsx](../../../app/skills/[slug]/DetailTabs.tsx)：在 `Tab` 联合类型加入 `comparison`。
  - **访客**：仅当存在已发布对比时显示该 tab。
  - **owner/admin**：永远显示（无对比时进引导）。
  - 由 [page.tsx](../../../app/skills/[slug]/page.tsx) 服务端计算 `showComparison`（`privileged || hasPublishedComparison`）并下传，沿用 `showManage` 的既有模式。

### 8.3 `ComparisonTab.tsx`（server component）

- 访客视图：结构化模板渲染
  1. **一句话价值**
  2. **关键能力**（要点列表）
  3. **Before / After**（两栏：左「不装」`example.withoutOutput`，右「装上」`example.withOutput`）
  4. **适用场景**
- 正文 = `bodyMd`（用 [MarkdownRenderer](../../../components/MarkdownRenderer.tsx) 渲染） + `example` 的双栏组件。
- owner/admin 额外显示「编辑对比」入口，进入工坊。

### 8.4 `ComparisonStudio.tsx`（client component, owner-only）

- 第 5 节的工坊：样例任务输入 → 「实测」（调 baseline）→ 分析对话（调 workshop，流式）→ 对某条回复「用作对比」→ Markdown 编辑器 → `保存草稿` / `发布`。
- 可改的定向 prompt 输入框（预填 `guidancePrompt` 或系统默认）。
- 复用既有 UI 约定：`.surface`、`accent-500`、`MarkdownRenderer`、[pushToast](../../../components/Toaster.tsx)、`useTranslations`。

### 8.5 作者入口（三处可进工坊）

1. 新建技能 [UploadWizard.tsx](../../../app/skills/new/UploadWizard.tsx)：发布后引导"去生成对比"（可选，不阻塞发布）。
2. 详情页对比 tab：owner 的「编辑对比」入口。
3. 编辑页 [EditForm.tsx](../../../app/skills/[slug]/edit/EditForm.tsx)：增加进入工坊的链接/区块。

### 8.6 i18n

- 新增 `detail.comparison.*`（zh-CN + en，[messages/](../../../messages/)）：tab 名、模板小标题、工坊各步骤文案、空态引导等。

## 9. 不在本期范围（YAGNI）

- 多组 Before/After 样例（v1 仅单组）。
- 对比的版本化历史 / 编辑审计。
- 访客对对比点赞、评论。
- 模型 allow-list / 按 provider 校验模型名（先接受 env 配置值）。
- per-version 对比。

## 10. 验收标准

1. Try It tab 只剩 Chat，无 Compare 切换；Chat 仍可用且走 `lib/llm`。
2. 作者能在工坊：填样例 → 实测得到两段真实输出 → 与模型几轮对话产出结构化报告 → 采用某条 → 编辑 → 保存草稿 / 发布；事后可再次进入修改。
3. 访客在「对比」tab 看到结构化、清晰的对比（价值 / 能力 / Before-After / 场景），访客侧不触发任何 LLM 调用。
4. 对比 tab 的可见性遵守 skill `visibility`（public / restricted / private）。
5. 仅改 `LLM_*` 环境变量即可把 Chat 与对比生成切到非 Anthropic（OpenAI 兼容）模型，无需改代码；未设 `LLM_*` 时回退现有 Anthropic 行为，站点不破。
6. `pnpm build` 全部路由编译通过；新迁移可 `pnpm db:migrate` 应用。
