# 版块报告（聊天记录 → 日报/周报/月报）、帖子版本历史与同时编辑

> 2026-10-20 新增。入口 `/zones/[slug]/reports/*`、`/zones/[slug]/posts/[postId]/history`；
> 契约模块 `lib/zones/reports/*`、`lib/zones/post-revisions.ts`、`lib/zones/post-presence.ts`。
> 与独立 skill `chat-report`（opencode / deepseek 侧）共用同一份数据契约 `report.json v1`
> （skill 里的 `schema/report.schema.json` ⇔ 站内 `lib/zones/reports/schema.ts`，改一处必须改另一处）。

## 0. 这是什么，为什么这么做

Owner 的诉求：「我会生成这样的聊天记录，配合提及的图片和文件，生成月报/周报/日报；把它作为版块里的一个工具；
文档自动录入知识库、在帖子侧边就能看；聊天里的人按工号匹配成作者并共同编辑，要避免冲突、能看到谁在同时改、有版本历史。」

四条设计决定：

1. **内容与呈现分离，模型只写小 JSON。** 旧流程让模型直接写带 HTML 的 JS 字面量（主题骨架写死、配图按「人 + 日期」匹配、无法溯源）。
   新流程：确定性代码做解析 / 统计 / 切片 / 校验 / 配图 / 渲染，模型分四步各输出一个小 JSON（聚类 → 逐主题 → 活动与花絮 → 要点），
   每步过 zod + 引用校验（消息 id 必须存在、url 必须出现在记录里、发言人账号必须在名单里）。这是 deepseek-v4-flash 这类模型也能稳定产出的前提。
2. **报告 = 帖子。** 生成结果渲染成 Markdown 正文发布为普通 `ZonePost`（走 `createZonePost`，所有现成能力——栏目、可见性、评论、点赞、嵌入卡片、并排阅读——
   零改动可用）；`report.json` 原样存在 `ZoneReport.reportJson`，随时可重渲染。没有「报告帖」这种新类型。
3. **文档进知识库，不复制一套。** 聊天附带的 PDF / HTML / PPT / Word 走 `createDocFromFile`（去重、章节提取、AI 导读全部复用），
   正文里用 `[embed:library:<slug>]`，读者点卡片就在右侧并排阅读面板里打开（zones 已有）。
   「把知识库下放到版块」= 每个版块有自己的「资料」视角（`listZoneLibraryDocs`：本版块报告收录的文档），不是第二套存储。
4. **合著 = 现有的 `ZonePostAuthor`。** 聊天里的发言人按工号 → `User.huaweiW3Id` 匹配（`accountMatchKey` 数字串比对，和员工名单同一条规则），
   发布时写成合著者，他们天然拥有编辑权（`canEditZonePostContent` 不变）。冲突由**乐观并发 + 版本快照 + 在线编辑者提示**三件套处理，
   不做 OT/CRDT 实时协同（没有这个基础设施，也没有这个必要）。

## 1. 数据模型（migration `20261020120000_zone_reports_post_revisions`）

| 表 | 作用 | 关键字段 |
| --- | --- | --- |
| `ZoneReport` | 一次生成任务 + 结果 | `zoneId, createdById, kind(daily/weekly/monthly/custom), title, subject, periodStart/End, status(queued→parsing→clustering→summarizing→assembling→ingesting→ready / failed), stage, progress(0-100), error, sourceKey/sourceName（聊天文件，zone media `file/` key）, manifestKey（图片附件清单 CSV，可空）, messagesJson, clusterJson, reportJson, authorMatches, postId(@unique), heartbeatAt` |
| `ZoneReport.bundleKey / namesJson`（migration `20261020160000_zone_report_bundle_setting`） | 整包上传 | `bundleKey`：一次上传的整个文件夹 / zip（`file/*.zip`），流水线第 0 步解包；`namesJson`：welink-cli 输入的账号→姓名 |
| `ZoneReportSetting`（同上迁移） | 报告用的模型（一行，id `default`） | `useLibrary`（默认 true = 沿用知识库 AI）+ 与 `LibrarySetting` 同形的 `llmProvider/llmBaseUrl/llmApiKey/llmModel/llmDisableThinking/llmJsonMode` |
| `ZoneReportAsset` | 上传的图片 / 文件 | `reportId, key(@unique zone media key), name（原文件名，用来和 report.attachments[].file 对上）, kind(image/file), mimeType, sizeBytes, libraryDocId（收录进知识库后）` |
| `ZonePostRevision` | 帖子内容快照 | `postId, number(1..n, @@unique[postId,number]), editorId, title, summary, bodyMd, note, createdAt` |
| `ZonePostEditor` | 谁正在编辑 | `@@id[postId,userId], startedAt, lastSeenAt` |
| `ZonePost.revision Int` | 当前内容版本号 | 内容（title/summary/bodyMd）变化时 +1，并写一条 `ZonePostRevision` |

`ZoneReport.messagesJson` 可达几百 KB（535 条 ≈ 400 KB jsonb），只在流水线里读；列表/状态接口永远不 select 它。

## 2. 流水线（`lib/zones/reports/pipeline.ts`）

`triggerZoneReport(id)` 与知识库 `triggerIndexing` 同款：fire-and-forget，状态落在行上，页面轮询 `GET /api/zones/[slug]/reports/[id]`。

```
queued ─parse（parse.ts: TXT / welink-cli JSON → messages；manifest CSV → 附件对消息；assets 对文件名）
     ─digest（digest.ts: 有信息量的消息一行一条 + stats + links）
     ─clustering（LLM ① → clusterSchema + 覆盖率校验；超 60k 字按天分片、逐片聚类再合并）
     ─summarizing（slice.ts 切 bundle → LLM ② 逐主题，并发 2，validateTheme 引用校验；LLM ③ 活动与花絮；outline → LLM ④ 要点）
     ─assembling（assemble.ts: 统一姓名、编号、按消息邻域配图、未归类、stats → report.json；validateReport）
     ─ingesting（可选：PDF/HTML/PPTX/DOCX 附件 → createDocFromFile → asset.libraryDocId；失败只记日志）
     ─ready / failed（error 里是哪一步、什么错；retry 从失败的那一步继续，中间产物都在行上）
```

- LLM 走 `getReportProvider()`（`lib/zones/reports/provider.ts`）：`ZoneReportSetting.useLibrary` 为 true（默认）时沿用 `getLibraryProvider()`（/manage/library 的配置 → env），否则用 `/manage/zones/report-llm` 单独配的那份；两者都经 `buildLlmOverride` → `llmFetch`，**默认直连**内网模型，只有 `LLM_USE_PROXY=true` 才按主机走代理（platform.md）。`json: true`，每步最多重试 2 次：JSON 解析失败或校验器报 ✖ 时把错误原样贴回模型。后台「测试连接」要求模型回 `{"ok":true}`，顺便验证 JSON 模式真的能用。
- `heartbeatAt` 每步更新；`running` 超过 `STALE_LOCK_MS`（10 分钟）无心跳视为死亡，`retry` 可重新认领（与 translate-doc 同一套锁语义）。
- **导入模式**：上传 skill 产出的 `report.json`（`importKey`）则跳过 ①–④，只跑 validateReport + 附件匹配 + ingesting。opencode 侧生成、站内发布。
- 模型永远不碰：发言人姓名（由账号查名单）、配图（邻域规则）、统计、链接表、未归类审计。

### 2a. 整包上传（`bundleKey`，`lib/zones/reports/bundle.ts` + `unpack.ts`）

用户手里的是一个目录（WeLink 导出 TXT + 图片附件清单 CSV + 已下载的图片目录，或 welink-cli 的分页 JSON + `wl_names/`），
向导不再让他一个个挑：**选文件夹 / 选 zip / 多选文件 → 一个 zip、一次上传**（文件夹与多选在浏览器里用 JSZip 打包，图片 STORE、文本 DEFLATE；zip 原样上传；上限 = `MAX_ZONE_FILE_BYTES` 200 MB）。
识别规则是**一份纯函数** `planReportBundle(files)`（只看路径与大小，不读内容、不碰 node API），向导和服务端解包都调它，所以向导里显示的识别结果就是流水线用的：

| 规则 | 结果 |
| --- | --- |
| `report.json`（basename） | `importJson` → 导入模式，不调模型 |
| `*_msgs.json`（welink-monthly-report 的合并产物，信息最全） | `source`；旁边的 txt / 其他 json 忽略 |
| 否则最大的 `.txt` | `source`；其余 txt 当附件 |
| 没有 txt 时的 `.json`：1 个 → `source`；多个 → `sourcePages`（按 msgId 去重合并成一个数组） | 有 txt 时的 json 一律忽略（多半是 skill 的中间产物） |
| `.csv`：名字含 清单/manifest/attach/image 的优先，否则第一个 | `manifest`；其余 csv 当附件 |
| `names.json` / `wl_names/*.json` | `names` → `namesJson`（账号→姓名） |
| png/jpg/gif/webp/avif | 附件 image；其它扩展名 → 附件 file |
| `.DS_Store`、`__MACOSX/`、`work/`、点开头、0 字节、嵌套 zip、`report.html/md`、`digest.md` 等 skill 产物 | 忽略（向导列出原因） |

服务端 `unpackReportBundle` 在 `parsing` 状态下跑（stage「解包上传的文件夹 / zip」），落盘成普通 zone media（key 永远是 nanoid，zip 内路径从不进磁盘路径，无 zip-slip），建 `ZoneReportAsset`（同名只建一次，可重入），回写 `sourceKey/manifestKey/importKey/namesJson`；之后的流程与逐个上传完全一样。条目 ≤ 3000、附件 ≤ 300、单文件按 kind 的上限，超了跳过并记进日志。

## 3. 发布（`publishZoneReport`）

`POST /api/zones/[slug]/reports/[id]/publish { coauthorUserIds, columnId, visibility, status: 'draft'|'published', libraryEmbeds: boolean }`

1. `render-md.ts` 把 `reportJson` 渲染成帖子 Markdown：要点 → 各主题（定位 / 宏观 / 观点时间线 / 结论 / 待验证 / 资料）→ 活动表 → Recap → 资源索引 → 数据概览 → 附录。
   图片 = `![](/api/zones/media/<key>)`（MarkdownRenderer 自己过 `withBasePath`）；文件 = `[embed:file:<key>]`；已收录的文档 = `[embed:library:<slug>]`（右侧并排阅读）。
2. `createZonePost(zone, actor, input)`：`attachments` = 全部 assets（服务端再和正文 file key 取并集，契约不变）、`coauthorIds` = 用户勾选的匹配结果（默认全选已匹配的发言人，创建者本人除外）、`tags` = 主题关键词 ≤ 6。
3. `ZoneReport.postId` 写回；之后 `reportJson` 只作存档，正文以帖子为准（合著者会继续改它）。
4. 发布为 `published` 走 `createZonePost` 原有的合著者通知；`draft` 则跳到编辑页让创建者先审一遍。

**工号匹配（`authors.ts`）**：`roster[].account`（`l00974474`）→ `accountMatchKey`（数字串 `00974474`）→ `User.huaweiW3Id` 的数字串；
一次 `findMany` 预过滤 `huaweiW3Id contains <digits>` 再精确比对（和 `lib/employee-directory.ts` 一样，预过滤永远不单独信）。
未匹配的发言人保留在报告正文里（姓名 + 账号），只是不成为合著者；页面上列出「未匹配」让创建者知道。
**隐私**：authorMatches 返回给页面前过 `toPublicAuthor(…, canSeeIdentity)`，手机/邮箱永远不出现。

### 3a. 帖子页的原生渲染（`ReportArticle`，2026-10-20 第二轮）

用户评价 Markdown / 纯 HTML 版"分不清主次、谁说的和说了什么混在一起、来源点不开"。所以报告帖子**不走 Markdown 正文**：

- `getZonePostDetail` 多带 `post.report`（`lib/zones/reports/post-view.ts`：`reportJson` + 发言人账号→站内用户（工号匹配，`toPublicAuthor` 脱敏）+ 附件文件名→知识库 slug + 附件 id→媒体 URL），`headings` 改由 `reportHeadings(report)`（`sections.ts`）生成，右栏目录照常工作。
- `PostDetail`：`post.report` 存在 ⇒ 渲染 `app/zones/_components/reports/ReportArticle.tsx`，否则照旧 Markdown。发布前的预览页（`ReportDetail`）用的是**同一个组件**，所见即所得。
- `ReportArticle` 做 Markdown 做不到的事：要点卡（编号圆点 / ■ 判断 + 置信度 / 待办表，负责人是头像）；专题 = 宏观总结面板 → **观点时间线**（头像骑在线上、匹配上的带悬停名片；角色色标 提出=墨 / 质疑=琥珀 / 判断·结论=绿 / 进展=天蓝；`**…**` 高亮关键词；原话引用；配图缩略 → `BodyImageLightbox`；来源 chips → 右侧 dock 的 `link` 卡片（**预置 `data`，不发 /api/zones/embed**，外网链接内网机器本来也抓不到）；已收录文档 → dock 的 `library` 卡片；「看原文 N」→ dock 以 `page` 目标装 `/zones/[slug]/reports/[id]/messages?ids=m1,m2`）→ 待验证 → 资料 → 启示框；活动表、Recap、资源索引、数据概览（横条）、未随文附件。
- `/zones/[slug]/reports/[reportId]/messages`（`lib/zones/reports/messages.ts`）：按 id 从 `messagesJson` 取原始消息（时间 / 发言人 / 原话 / 引用 / 链接卡片 / 图片），`canRead` 门；装在 iframe 里时 `holdNavBarHidden()` 藏掉导航栏。一次 ≤ 60 条。
- **编辑**：报告帖子的 `bodyMd` 仍由 `renderReportMarkdown` 生成，只做摘要 / 搜索 / 回退；编辑器顶部有一条说明（`report_post_native_note`），改正文不会改报告视图——要改内容请重新生成。站内翻译对原生视图不适用（`TranslatableScope` disabled）。
- 枚举显示文案走 i18n（`report_role_* / report_tag_* / report_conf_*`），存的值永远是模型词表里的中文。
- 配色守 ui.md：chrome 全墨；颜色只出现在内容语义上（角色色标、`<mark>` 高亮、头像身份色）。

## 4. 版本历史与同时编辑（所有帖子，不只报告）

- **快照**：`updateZonePost` 在 `contentChanged`（title / summary / bodyMd 任一变化）时，在同一事务里 `revision += 1` 并插入 `ZonePostRevision{number: revision}`。
  第一次编辑前的原文也要能找回：首次产生快照时先补写 `number 1 = 保存前的内容`（`editorId` = 原作者），所以历史里永远能看到发布时的版本。
  草稿阶段的自动保存不写快照（和 `editedAt` 同一条件）。
- **乐观并发**：`PATCH /posts/[postId]` 接受 `baseRevision?: number`。带了且 ≠ 当前 `revision` → **409 `stale_revision`**，body 带 `{ revision, editedBy, editedAt }`，什么都不写。
  不带 `baseRevision` 的客户端（CLI / 旧接口 / 版主只改 pinned）行为不变。合著者的编辑器一定带。
- **编辑器处理 409**：弹层「X 在 n 分钟前保存了新版本」，三个选择：**查看最新版本**（新标签打开帖子 / 历史）、**在最新版本上重做**（刷新 composer，本地草稿留在 localStorage 可复制）、**仍用我的版本覆盖**（以服务器当前 `revision` 重发；被覆盖的内容仍在历史里，可恢复）。
- **在线编辑者**：composer 打开已有帖子后每 20 s `PUT /posts/[postId]/editors`（upsert lastSeenAt），返回 60 s 内活跃的其他编辑者（公开身份）；关闭 / 离开 `DELETE`。
  顶栏显示「周春华 也在编辑 · 3 分钟前开始」。阅读页头部同样显示「正在编辑」（同一接口 GET）。这是提示，不是锁——锁会把合著者挡在外面，与「共同编辑」相悖。
- **历史页** `/zones/[slug]/posts/[postId]/history`（`canRead`）：列表（第 n 版 · 编辑者 · 时间 · 备注 · 字数增减）→ 选中后并排显示（当前 | 选中，Markdown 源）→ **恢复此版本**（编辑权限）= 以快照内容走一次 `updateZonePost`，产生新版本，永不覆盖历史。
  接口与 Wiki 修订一一对应：`GET /revisions`、`GET /revisions/[id]`、`POST /revisions/[id]`（恢复）。
- `ZonePostDetailView` 新增 `revision: number`、`revisionCount: number`；帖子头部多一个「历史 (n)」链接。

## 5. 版块里的「资料」视角（知识库下放）

不新建存储。`lib/zones/reports/library.ts#listZoneLibraryDocs(zoneId, viewer)`：本版块所有报告 assets 的 `libraryDocId` ∪ 本版块帖子正文里 `[embed:library:]` 引用的文档，
过 `canReadDoc` 后按收录时间排序。页面 `/zones/[slug]/reports` 右栏列出（点击在并排面板打开）。以后要让版主直接在版块上传资料，就是「上传 → createDocFromFile → 记一条 ZoneReportAsset 到一个『手工收录』报告」，模型已经允许 `reportJson = null` 的行。

## 6. 权限与限流

| 动作 | 门 |
| --- | --- |
| 看报告列表 / 详情 | `access.canRead`；详情里的 `authorMatches` 过身份脱敏 |
| 新建 / 重试 / 删除 / 发布 | `access.canPost`（发布为帖子再过 `createZonePost` 自己的门）；删除还要是创建者或 `canModerate` |
| 上传聊天文件与附件 / 整包 zip | 复用 `/attachments/upload`（`canPost ∥ canModerate`） |
| 报告模型配置 `/manage/zones/report-llm`、`/api/admin/zones/report-llm{,/test}` | 站级 `zones` 权限（`requirePermission` / `gateApi`），保存走 `logAdmin` |
| 历史 | `canRead`；恢复 = `canEditZonePostContent` |
| 在线编辑者心跳 | `canEditZonePostContent` |
| 限流 | 新建报告 5 次 / 小时 / 人（LLM 成本）；心跳不限 |

## 7. 文件清单

```
lib/zones/reports/
  schema.ts        zod：cluster / theme / recap / overview / report + validate*（引用校验，可独立测）
  parse.ts         TXT / welink-cli JSON → messages；manifest CSV；表情码、卡片、um_begin 协议
  digest.ts        digest 文本 + stats + links（含按天分片）
  slice.ts         主题 bundle 文本
  prompts.ts       四段提示词（与 skill prompts/*.md 同文）
  llm.ts           callJson：provider.complete(json) + 解析 + 校验回贴重试
  assemble.ts      report.json 装配 + 邻域配图
  render-md.ts     report.json → 帖子 Markdown（含 embed 令牌）
  authors.ts       工号 → 用户匹配
  bundle.ts        整包上传的识别规则（纯函数，向导与服务端共用）+ welink-cli 分页合并 + 姓名表
  unpack.ts        zip → zone media + ZoneReportAsset + 回写 source/manifest/import/names
  provider.ts      getReportProvider：ZoneReportSetting（沿用知识库 / 单独）→ LLMProvider，60 s 缓存
  pipeline.ts      状态机 + triggerZoneReport + retry + 导入模式 + 第 0 步解包
  sections.ts      原生视图的 section id + 目录（客户端 / 服务端共用，纯函数）
  post-view.ts     post.report：reportJson + 发言人→用户 + 附件→知识库 slug / 媒体 URL
  messages.ts      「看原文」：按 id 取原始消息
  queries.ts       视图、列表、创建、删除、publishZoneReport
  library.ts       附件 → 知识库收录；listZoneLibraryDocs
lib/zones/post-revisions.ts   快照 / 列表 / 恢复
lib/zones/post-presence.ts    心跳 / 活跃编辑者
app/api/zones/[slug]/reports/route.ts, [reportId]/route.ts, [reportId]/publish/route.ts, [reportId]/retry/route.ts
app/api/admin/zones/report-llm/route.ts, test/route.ts；app/manage/zones/report-llm/page.tsx, ReportLlmCard.tsx
app/api/zones/[slug]/posts/[postId]/editors/route.ts, revisions/route.ts, revisions/[revisionId]/route.ts
app/zones/[slug]/reports/page.tsx, new/page.tsx, [reportId]/page.tsx, [reportId]/messages/page.tsx
app/zones/_components/reports/ReportArticle.tsx, ReportMessages.tsx, report-bits.tsx（RichText / Speaker / SourceChips / Thumbs）
app/zones/[slug]/posts/[postId]/history/page.tsx
app/zones/_components/reports/*（ReportWizard / ReportProgress / ReportPublishPanel / ReportList）
app/zones/_components/post/PostHistory.tsx, EditorsBand.tsx, StaleRevisionDialog.tsx
tests/zone-reports-*.test.ts, tests/zone-post-revisions.test.ts
```

## 8. 踩过 / 预判的坑

1. `messagesJson` 不进列表 select；`reportJson` 只在详情与发布时读。
2. 聚类覆盖率 < 85% 直接判错让模型补；别放宽——漏掉的消息就是漏掉的内容。
3. url 校验是「记录里出现过」而不是「可访问」：内网机器不能出公网，不要在流水线里 fetch 链接。
4. 发言人姓名以名单为准（账号查），模型写错名字不影响渲染。
5. **报告正文的文风**（render-md.ts，与 skill 的 render.mjs 同一套）：内部技术汇报风——章节标题带【】标签、主线判断直接做引文、每个专题以「启示」收束；**没有**「一句话」之类的标签词、统计药丸、置信度徽章（用户评价那种"很 AI"）。HTML 版白底、华为红 `#E60012` 是唯一强调色。改结构先改 skill 的 `reference/report-structure.md`，两边保持同序。
6. 整包上传的识别只看文件名：一个目录里放两份不同群的 TXT 会只取最大的那份——向导会把识别结果显示出来，让用户自己看。
9. TXT 有两种版式（`parse.ts` 顶部注释）：`[YYYY-MM-DD HH:mm:ss] 姓名（账号）`，以及 welink-monthly-report 的 `#### 日期 ####` + `[HH:mm:ss] 姓名（账号）· 类型`。两种都是 agent 从 welink-cli JSON 转的，JSON 更全（附件协议块 / 引用卡片），整包上传时 `*_msgs.json` 优先于 TXT（bundle.ts `MSGS_JSON_RE`），别的 json 名字不认——用户目录里 TXT 和 JSON 通常并存。给 agent 的拉取话术在 skill 的 `reference/welink-fetch.md`。
8. `ReportArticle` 是客户端组件：只能 import `sections.ts` 这类纯模块，**不要** import `post-view.ts` / `messages.ts`（它们带 prisma）；类型用 `import type`。
7. welink-cli 不能搬到服务端：它要 WeLink PC 客户端在本机运行 + 手机扫码（约 90 分钟有效）+ 下载附件要绕开公司代理。拉取永远在用户自己的电脑上做，站内只接收结果。
5. 配图只认 `report.attachments[].file` 与 `ZoneReportAsset.name` 的文件名相等（大小写敏感）；清单里的文件名就是云盘下载的文件名。
6. 快照条件和 `editedAt` 完全一致（内容变化且已发布）；草稿自动保存不进历史，否则每次打字都是一版。
7. 409 的判断在 `updateZonePost` 事务里再做一次（`updateMany where revision = base` 守卫写），路由层的预检只是为了给出友好 body。
8. 心跳表要定期清：`PUT` 时顺手删掉本帖 10 分钟没心跳的行；不做定时任务。
