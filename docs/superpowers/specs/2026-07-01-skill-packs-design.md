# Skill 合集包（Skill Packs）设计

日期：2026-07-01

## 目标

管理员把多个 skills 组合成一个「合集包」（pack），用户一条命令安装包内全部 skills。
一个 skill 可以复用进多个包。浏览页在现有 tab（全部/社区/官方搬运/内部专用）旁增加
「合集包」tab；每个包有介绍（包含什么、适用什么场景），支持 AI 一键生成。

## 数据模型

```prisma
model SkillPack {
  id            String   @id @default(cuid())
  slug          String   @unique          // CLI 安装引用：skills install pack:<slug>
  name          String
  summary       String   @default("")     // 一句话：什么场景装这个包
  descriptionMd String   @default("")     // 富文本：包含内容 / 适用场景 / 使用建议
  icon          String   @default("")     // 可选 emoji
  isPublished   Boolean  @default(false)
  sortOrder     Int      @default(0)      // 管理员控制展示顺序
  installCount  Int      @default(0)      // CLI manifest via=install 时 +1
  createdById   String?
  ...
  items SkillPackItem[]                    // 有序成员
}

model SkillPackItem {
  packId / skillId / sortOrder
  @@unique([packId, skillId])              // skill 可复用于多个包，同包不重复
}
```

约束：只允许把 `published` + 非 `private` 的 skill 加入包（restricted 允许，装不了的
成员 CLI 会逐个报错并继续）。skill 删除时级联移出所有包。

## 安装链路

- 命令：`skills install pack:<slug>`。CLI 同时改为支持多参数
  `skills install <a> <b> ...`（修复 CompositionTab 已展示但 CLI 实际不支持的语法）。
- CLI 遇到 `pack:` 前缀 → `GET /api/packs/<slug>/manifest?via=install` 拿成员
  slug 列表 → 去重后逐个走现有 installCommand（单个失败不中断，最后汇总）。
- manifest 只返回 published/非私密/未删除的成员；`via=install` 时 fire-and-forget
  `installCount + 1`。每个 skill 的下载计数仍由 `/raw` 记录，不重复计。

## 页面

- 浏览页 `/skills?source=packs`：SourceTabs 增加「合集包」tab；该视图下隐藏
  侧栏筛选与排序（对包无意义），保留搜索与分页；渲染 PackCard 网格。
- PackCard：icon + 名称 + 一句话 summary + 成员 skill 名 chips（前 3 个 + N）+
  安装次数。点击进 `/packs/<slug>`。
- 详情页 `/packs/<slug>`：名称/summary/安装命令（复用 InstallSnippet，slug 传
  `pack:<slug>`）/ Markdown 介绍 / 「包含的 Skills」用现有 SkillCard 网格。
  未发布的包仅管理员可见（带草稿标记），其他人 404。

## 管理后台

- `/manage/packs`（新导航项「合集包」）：列表 + 编辑器（categories/announcements
  模式：RSC 取数 + client 编辑器 + `/api/admin/packs` 路由 + logAdmin 审计）。
- 编辑器：名称、slug（自动 slugify）、emoji、一句话、RichTextEditor 介绍、
  skill 选择器（搜 `/api/skills?q=`，添加/移除/上下移排序）、发布开关。
- AI 一键生成介绍：assist 新 action `pack` —— 输入成员 skills 的 name/summary，
  产出 summary + descriptionMd（含「包含内容」「适用场景」小节）。复用现有
  /api/skills/assist 全链路（限流、错误处理、JSON 解析）。

## 顺手补齐的管理端缺口（本次一并做）

1. `canUseCli=false` 生效：verifyCliToken 拒绝该用户的 PAT（现在开关是摆设）。
2. `dailyDownloadLimit` 生效：/raw 在过去 24 小时窗口内计数（排除 via=try、
   owner/admin 豁免），超限 429 + 中文提示。
3. 移除管理后台死链「更新日志 /manage/changelogs」（页面不存在）。

## 不做（YAGNI）

- 包版本化/锁定成员版本（成员始终装当前版本）。
- 包的点赞/评论/订阅。
- 全站搜索纳入包（后续可加）。
- CLI tarball 重新发布（代码已改好，发布仍走 `./scripts/release-cli.sh <地址>`，
  属于部署动作，由运维选地址执行）。
