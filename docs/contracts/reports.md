# 「聊天记录 → 报告」工具（日报/周报/月报）、报告分享页、帖子版本历史与同时编辑

> 2026-10-20 新增，同日第三轮改成**导航「工具」下的独立工具**（owner：「把这个打包成一个工具，而不是强绑定到技术专区里；
> 原生适配技术专区这点不要改；我之后也会在工具这个导航栏里加入更多工具」）。
> 入口 `/tools`（工具中心，目录 `lib/tools/catalog.ts`）→ `/tools/chat-report`（我的报告 / 新建 / 详情）；
> 分享页 `/reports/[slug]`（+ `/messages` 看原文）；帖子版本历史 `/zones/[slug]/posts/[postId]/history`。
> 契约模块 `lib/zones/reports/*`（目录名沿用）、`lib/zones/post-revisions.ts`、`lib/zones/post-presence.ts`。
> 与独立 skill `chat-report`（opencode / deepseek 侧）共用同一份数据契约 `report.json v1`
> （skill 里的 `schema/report.schema.json` ⇔ 站内 `lib/zones/reports/schema.ts`，改一处必须改另一处）。

## 0. 这是什么，为什么这么做

Owner 的诉求（三轮）：「我会生成这样的聊天记录，配合提及的图片和文件，生成月报/周报/日报」→「不要放在每个 zone 里，放到导航里的
一个工具里；用户可以输入自己的 prompt 添加或覆盖指令；生成后可以导出 Word / PDF、分享到技术专区指定领域的帖子里、或单独生成一个可设置谁可读的页面；
提交后异步生成，完成后提醒（站内 + 邮件开关）；失败记录在用户自己这里、可删除；文件识别不要依赖文件名」。

一张表记住现在的形状：

| 事情 | 在哪 | 谁能 |
| --- | --- | --- |
| 新建（上传整个目录 / zip，按内容识别；补充要求） | `/tools/chat-report/new` → `POST /api/tools/chat-report` | 任何登录用户（5 次 / 小时） |
| 生成 | 后台流水线（`pipeline.ts`），页面轮询；完成 / 失败 → `notifyReportReady`（站内 + 邮件各一个偏好开关，默认开） | — |
| 我的报告列表 / 详情 / 重试 / 删除 | `/tools/chat-report`，`/tools/chat-report/[id]` | 创建者（或站级 `zones` 管理员） |
| 导出 Word / PDF | `GET …/export?format=docx\|pdf`（`export-docx.ts` / `export-pdf.ts`） | 能看分享页的人 |
| 分享页 + 谁可读 | `/reports/[slug]`，`PATCH …/[id] { visibility, audienceUserIds }`（通用 audience，kind `report`） | 所有者改；读者按闸门 |
| 分享到技术专区 | `POST …/[id]/publish { zoneSlug, columnId, visibility, coauthorUserIds… }` → `createZonePost`，帖子页原生渲染（§3a） | 所有者，且在目标版块 `canPost` |
| 改合著者（分享后随时） | 工具详情页 `ReportCoauthors` → `PUT …/[id]/coauthors { userIds }` → `updateZonePost({ coauthorIds })` | 所有者 |

四条设计决定：

1. **内容与呈现分离，模型只写小 JSON。** 旧流程让模型直接写带 HTML 的 JS 字面量（主题骨架写死、配图按「人 + 日期」匹配、无法溯源）。
   新流程：确定性代码做解析 / 统计 / 切片 / 校验 / 配图 / 渲染，模型分四步各输出一个小 JSON（聚类 → 逐主题 → 活动与花絮 → 要点），
   每步过 zod + 引用校验（消息 id 必须存在、url 必须出现在记录里、发言人账号必须在名单里）。这是 deepseek-v4-flash 这类模型也能稳定产出的前提。
2. **报告归用户，分享才落到版块。** `ZoneReport`（表名沿用）由创建者所有、`zoneId` 可空；「分享到技术专区」时走 `createZonePost`
   发成普通 `ZonePost`（栏目、可见性、评论、点赞、合著全部现成）并把 `zoneId / postId` 写上，帖子页靠 `post.report` 原生渲染（§3a）。
   `report.json` 原样存在 `ZoneReport.reportJson`，随时可重渲染 / 导出。没有「报告帖」这种新类型。
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
queued ─parse（parse.ts: 任何形状 JSON / TXT / CSV → messages，都认不出时 infer-format.ts 让模型推断行头格式；manifest CSV → 附件对消息；assets 对文件名）
     ─digest（digest.ts: 有信息量的消息一行一条 + stats + links）
     ─clustering（LLM ① → coerceCluster → clusterSchema + 覆盖率校验 → 重试用尽 autofix / fallbackCluster；超 60k 字按天分片、逐片聚类再合并）
     ─summarizing（slice.ts 切 bundle → LLM ② 逐主题，并发 2，coerceTheme + validateTheme → fallbackTheme；LLM ③ 活动与花絮；outline → LLM ④ 要点；每一步都「收，不拒」§2d）
     ─assembling（assemble.ts: 统一姓名、编号、按消息邻域配图、未归类、stats → report.json；validateReport）
     ─（ingesting 已停用，2026-10-21：附件不再自动进知识库——所有者在工具详情页按个「分享到知识库」，`library.ts#ingestOneReportAsset`）
     ─ready / failed（error 里是哪一步、什么错；retry 从失败的那一步继续，中间产物都在行上）
```

- LLM 走 `getReportProvider()`（`lib/zones/reports/provider.ts`）：`ZoneReportSetting.useLibrary` 为 true（默认）时沿用 `getLibraryProvider()`（/manage/library 的配置 → env），否则用 `/manage/zones/report-llm` 单独配的那份；两者都经 `buildLlmOverride` → `llmFetch`，**默认直连**内网模型，只有 `LLM_USE_PROXY=true` 才按主机走代理（platform.md）。`json: true`，每步最多重试 2 次：JSON 解析失败或校验器报 ✖ 时把错误原样贴回模型。后台「测试连接」要求模型回 `{"ok":true}`，顺便验证 JSON 模式真的能用。
- `heartbeatAt` 每步更新；`running` 超过 `STALE_LOCK_MS`（10 分钟）无心跳视为死亡，`retry` 可重新认领（与 translate-doc 同一套锁语义）。
- **导入模式**：上传 skill 产出的 `report.json`（`importKey`）则跳过 ①–④，只跑 validateReport + 附件匹配 + ingesting。opencode 侧生成、站内发布。
- 模型永远不碰：发言人姓名（由账号查名单）、配图（邻域规则）、统计、链接表、未归类审计。

### 2a. 整包上传（`bundleKey`，`lib/zones/reports/bundle.ts` + `unpack.ts` + `parse.ts#parseRawMessages` + `infer-format.ts`）

用户手里的是一个目录（WeLink 导出 TXT + 图片附件清单 CSV + 已下载的图片目录，或 welink-cli 的分页 JSON + `wl_names/`），
向导不再让他一个个挑：**选文件夹 / 选 zip / 多选文件 → 一个 zip、一次上传**（文件夹与多选在浏览器里用 JSZip 打包，图片 STORE、文本 DEFLATE；zip 原样上传；上限 = `MAX_ZONE_FILE_BYTES` 200 MB）。

**原则（owner 2026-10-20 两轮）：按内容识别、不按文件名；而且不筛文件**——「为什么还要筛掉文件，如果别的文件能用就用别的啊，这里面不是也有 ai 介入吗？为什么对文件这么严格」。所以识别分三层：

1. **`planReportBundle(files)`（纯函数，向导与服务端共用）只负责把"肯定不是记录"的挑出去**：report.json → `importJson`（导入模式）；清单（表头含 文件名 + 外链/提取码，或 `[{fname,url}]`）→ `manifest`；姓名表（`wl_names/*.json`、`search_cli_person`、`{账号: 姓名}`）→ `names`；图片 / 其它扩展名 → `assets`；`.DS_Store`、`__MACOSX/`、`work/`、点开头、0 字节、嵌套 zip、`report.html/md/digest.md/messages.json` 等 skill 产物 → `ignored`。**剩下每一个 json / txt / csv / log / md 都是 `sources[]` 候选**：开头像 welink JSON / TXT 行头 / CSV 记录的排前面（`sniffText`，`guess: false`），认不出的排后面（`guess: true`，向导显示"会逐个试这 N 个文件"）。只有目录里一个文本文件都没有时 `bundleHasChat` 才为 false。
2. **服务端 `unpackReportBundle` 对每个候选真解析**（`parseRawMessages`：JSON → TXT → CSV 三个解析器都试，谁解析出带有效时间的消息多用谁）：解析为 JSON 的候选**全部合并**、按 msgId（没有就 时间:账号:内容前缀）去重——welink-cli 是分页的、`page_001.txt` 里装 JSON 也算；TXT / CSV 候选各自独立取最多的一份；最后 JSON 条数 ≥ 最佳 TXT 的 80% 就用 JSON（字段更全：附件协议块、引用卡片），否则用那份 TXT / CSV。选中的文本不再当附件。日志里记每个候选解析出多少条。**一个都解析不出也不在这里报错**：把最大的文本候选存成 `sourceKey`，交给第 3 层。
3. **流水线 parse 阶段的模型兜底**（`infer-format.ts`）：确定性解析器一条都认不出时，把文件前 80 行给模型，让它写一个带命名分组 `(?<date>|?<time>) (?<name>) (?<account>)` 的行头正则（+ 可选日头正则），我们编译后在前 400 行里校验（≥ 8 行命中且时间能解析），通过就用它**确定性地**切分全文（`splitWithSpec`）→ `parseChat(text, { raw })`；不通过才抛 `describeUnparsed`（列出能认的形状 + 文件开头三行）。模型只看格式、不碰内容。

`parseRawMessages` 认的形状（skill 的 `reference/welink-format.md` §1 同一张表）：JSON——页 / 数组 / 页数组 / 把消息数组藏在 `messages·data·items·list·records·result…` 下的任何 JSON（递归找），字段名宽（时间 `serverSendTime/sendTime/timestamp/ts/time/date/时间`，毫秒 / 秒 / ISO / 本地时间都行；账号 `sender/account/from/w3account/发送人`；内容 `content/text/msg/message/body/内容`…）；TXT——A1 `[日期 时间] 姓名（账号）`（括号 / 秒 / 分隔符都可变）、A2 日头 + `[时:分:秒] 姓名（账号）· 类型`（日头认 `####/====/----/【】/[]`）、A3 `姓名（账号） 日期 时间`；CSV——表头含「时间」+「内容」两列即可。

服务端 `unpackReportBundle` 在 `parsing` 状态下跑（stage「解包上传的文件夹 / zip」），落盘成普通 zone media（key 永远是 nanoid，zip 内路径从不进磁盘路径，无 zip-slip），建 `ZoneReportAsset`（同名只建一次，可重入），回写 `sourceKey/manifestKey/importKey/namesJson`；之后的流程与逐个上传完全一样。条目 ≤ 3000、附件 ≤ 300、真解析的候选 ≤ 24 个 / 单个 ≤ 64 MB，超了跳过并记进日志。

### 2d. 模型输出「收，不拒」（`coerce.ts` + `model-json.ts` + `llm.ts#callJson`）

owner 2026-10-20 第四轮：「聚类：重试 2 次后仍有问题 — JSON 形状不符合要求……怎么还是有这种问题，如果 json 一直会出问题，就不要用，我需要的是一致性和可靠性」。
以前每一步模型输出直接过 zod，id 写成数字、键名换叫法、标题超长、枚举写英文、引用了不存在的消息——任何一条都是 ✖ 贴回去重试，两次不行整条流水线 failed。现在 `callJson` 是四层：

| 层 | 在哪 | 做什么 |
| --- | --- | --- |
| 解析 | `model-json.ts#parseModelJson` | `extractJsonObject`（围栏 / 废话 / 全角 / 推理标签）→ 直接 parse → `jsonrepair`（尾逗号、注释、单引号、裸键、**被截断的结尾**）；顶层数组也收 |
| 规范化 | `coerce.ts#coerceCluster / coerceTheme / coerceRecap / coerceOverview`（`callJson` 的 `coerce`） | 过 zod **之前**：键名别名（`topics/messages/ids/refs/who/text…`）、`m12` ← `12 / "#12" / "m12-m15"`、`t1` ← `1 / theme_1`、超长截断、枚举映射（`consensus→共识`、`高→high`）、日期规整、**丢掉不存在的消息引用 / 记录里没有的 url**（记 warning）、**发言人与引用对不上 → 以引用消息的作者为准**、没引用 / 没正文的观点丢弃、主题 > 12 只留最大的 12 个 |
| 重试 | `callJson` | 规范化后仍过不了 zod / 引用校验才贴回模型重试（`retries` 默认 2）——现在几乎只剩内容问题（覆盖率不够、所有观点都没引用） |
| 兜底 | `callJson` 的 `onExhausted` → `autofixXxx / fallbackXxx` | 重试用尽：形状对了只是校验不过 → `autofixCluster`（没归类的凑成「其他讨论」/ 进 recap）、主题再过一遍 coerce；连形状都没有 → `fallbackCluster`（按日期分段 ≤ 8 段）、`fallbackTheme`（原文节选当观点、记录里的链接当资料）、`fallbackRecap`（每条原文一条）、`fallbackOverview`（主题定位拼要点）。**不抛错**，warnings 里记一条「模型 N 次输出都没过校验（…），已按规则兜底」，成品的 tagline / macro 里写着「模型…失败」让人看得出来 |

所以 `ReportLlmError` 现在只剩两种情况会抛：模型接口本身调不通（provider 错误），或 `onExhausted` 没配（目前每一步都配了）。错误文案带前 4 条具体问题，不再只有一句「JSON 形状不符合要求」。

导入模式同理：`coerceImportedReport` 修 `kind` 别名（月报 → monthly）、缺 `period`（从观点日期推）、主题 id、`summary`（缺 judgments / highlights 用主题定位补），再过 `reportSchema`——skill 那边 agent 产出的 report.json 不会因为外层小毛病进不来。

skill 侧同一份逻辑：`scripts/coerce.mjs`（由 coerce.ts `tsc` 转出，常量就地定义）；`validate.mjs --fix` 规范化并改写文件，`--fallback` 生成素版本；`lib.mjs#repairJson` 是零依赖的 jsonrepair。**改 coerce.ts 要重新转一份过去**（`pnpm exec tsc lib/zones/reports/coerce.ts --outDir /tmp/x --module esnext --target es2022 --moduleResolution bundler --skipLibCheck --isolatedModules --noResolve`，换掉头部 import）。

### 2b. 用户的补充要求（`instructions` / `instructionMode`，`prompts.ts#withInstructions`）

向导里一段自由文本 + 两种模式：`append`（加在默认写法之后、优先于默认写法）/ `override`（取代默认写法里关于内容取舍、详略与文风的部分）。
两种模式都插在每一步提示词的「## 输出格式」之前，并明说**字段名、JSON 形状、铁律与引用校验不变**——校验器照样会打回编造的 id / url。
「查看默认写法」展示的是 `writing-guide.ts` 的摘要（给人看的），不是提示词本身。详情页能看到本次用的要求。

### 2c. 异步 + 提醒

提交即返回（`triggerZoneReport` fire-and-forget），详情页轮询。流水线终态（ready / failed，重试再终态时再发一次）调
`notifyReportReady`（`lib/notifications.ts`）：`NotificationType.report_ready`，站内 `inAppReportReady` / 邮件 `emailReportReady` 两个偏好开关
（设置 → 通知 → 报告生成，默认都开），邮件模板 `notifyReportReadyEmail`。提醒失败绝不影响状态。

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

**阅读布局（2026-10-21 第五轮，owner 看完第一份真实月报的反馈）**——`components/reports/report-view.tsx`，三处（工具详情预览 / 分享页 / 帖子页）共用：

| 反馈 | 现在 |
| --- | --- |
| 「标题上面的 hashtag、日期都去掉，识别的根本不准」 | `publishZoneReport` 不再自动打标签（`tags: []`）；`PostHeader` 对报告帖子不渲染 `#tags`（老帖子的也藏掉）。要标签去帖子编辑里手动加 |
| 「只显示一个月报，不知道是几月的」 | 标题下一行 `ReportMeta`：`月报 · 2026-09-20 ~ 2026-10-20 · 消息 371 · 发言人 32 · 专题 8`——帖子页（PostHeader）、分享页、工具页都有；要点卡顶部原来那行类型 / 起止删掉 |
| 「摘要里加粗还是两个星号」 | 存库的 `summary` 过 `plainReportText`（去 `**` / `` ` ``）；`PostHeader` 对报告帖子用 `RichText` 渲染摘要（老帖子里残留的 `**` 也会高亮而不是露星号） |
| 「外链没必要弹侧边框再点进去」「很多链接 404、没录入」 | `SourceChips`：有 url 的来源 = `<a target=_blank>` 直接开，**不再走 dock 的 link 卡片**；只有**收录完成**（`LibraryDoc.status = ready`）的附件才给「知识库文档」chip（`post-view.ts#librarySlugsByName`、`getReportDetail` 都加了 `status: 'ready'`）——processing / failed 的在知识库里就是 404 |
| 「右侧都是空白的」「月报很长，拉到最底下非常困难」 | `ReportReader`：正文 + sticky 右栏（`lg` 起；dock 打开时 band narrow → 右栏让位）。右栏 = 目录（`reportHeadings`，随阅读位置高亮）→ 全部展开 / 收起 → 页面自己的段落（帖子页：作者 + **评论 N 按钮** → `CommentsDrawer` 从右侧滑入，开着时底部评论区不渲染，同一时刻只挂一份 `PostComments`；分享页：作者 + 「分享自 xx 版块」）→ 回到顶部。容器放宽到 `max-w-6xl` |
| 「看起来还是非常的长和乱」 | 专题的**观点时间线默认收起**（`ReportViewProvider`）：一个专题先只看 编号 + 标题 + 定位 + 宏观总结 + 待验证 + 资料 + 启示，时间线折成一行头像带「N 条观点 · M 位发言人 — 点击展开」；右栏「展开全部观点」一键全开。没有 provider 的调用方（老代码）一律展开 |
| 「图片放大后关闭屏幕闪一下」「最好能左右切换」 | 灯箱（`BodyImageLightbox`）关闭时不再立刻清掉 FLIP 状态（AnimatePresence 退场期间图片会瞬间 invisible，只剩黑底在淡——那就是"闪"），改在 `onExitComplete` 清，并且退场时图片飞回缩略图；FLIP 状态按 src 键控。`ReportArticle` 把整篇报告的图片按正文顺序排成相册（`ReportGalleryContext`），一个灯箱、两侧按钮 + ← → 切换、底部「n / N」和说明；相邻图切换不做 FLIP（淡入）。看原文页的 Thumbs 没有 provider，仍各自开 |
| 「合著者当时没加后面就加不了」 | `ReportCoauthors`（工具详情页，分享后出现）：发言人一键勾选 + 全站搜索，`PUT /api/tools/chat-report/[id]/coauthors` → `setReportCoauthors` → `updateZonePost({ coauthorIds })`（同一套校验、新加的人收到通知、不生成版本）。帖子编辑页的设置抽屉也能改 |

### 3b. 分享页与谁可读（`/reports/[slug]`，`visibility.ts`）

`ZoneReport.visibility ContentVisibility @default(private)` + `ContentAudience(kind 'report')`，照 audience.md 接入：编辑用 `VisibilityField`，
保存 `PATCH /api/tools/chat-report/[id] { visibility, audienceUserIds }`（同一事务写列 + `replaceAudience`，事务后 `newlyGrantedAudience` → 通知）。
**一个闸门** `canSeeReport(row, viewer, siteViewer)`：所有者 / 站级 `zones` 管理员总能看；`public` = 任何登录用户；`private`（隐藏）= 只有所有者；
`audience` = 名单；另外**已分享的帖子对这个人可见 ⇒ 报告也可见**（帖子里的「看原文」靠它）。分享页、看原文页、导出、详情 API 都走它。
slug = 标题 slug（`pickReportSlug`，kind `report`，全站唯一），`/reports/<id>` 与退休 slug 301 到它（`resolve.ts`）。

**链接地址（2026-10-21）**：报告的 slug 用 `lib/slug-ascii.ts#asciiTitleSlug`——中文转无调拼音（pinyin-pro，服务端），其余同 `titleSlug`，
所以 `/reports/jia-yan-si-xiang-yuan-2026-nian-9-yue-yue-bao` 粘到 WeLink / 微信里不会变成一串百分号（owner：「链接会变成编码……就算是英文也行」）。
所有者可在分享页设置里手填「链接地址」（`PATCH { slug }`，服务端再规范化一次；空 = 按标题重新生成），换掉的旧 slug 退休成
`SlugAlias(kind='report')`，老链接 301 到新地址。同日 owner 决定全站一起换（slugs.md「全站拼音 slug」）：`freeTitleSlug` 统一 ASCII 化，`pnpm slugs:ascii` 迁移已有数据。

### 3c. 导出（`export-docx.ts` / `export-pdf.ts`）

Word 用 `docx` 包纯 JS 生成（文风同 skill 的 HTML：红标题 + 【】标签、要点编号、专题 → 宏观 / 时间线 / 红底启示、活动表、页脚三件套；
图片从媒体库按 assetKey 读入，webp/avif Word 不认只留文件名）。PDF = soffice 把这份 docx 转一遍（和 office-preview 同一套调用），
没装 LibreOffice 时 501，前端提示先导 Word 再本机另存为 PDF。

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

## 5. 附件与知识库的关系（2026-10-21 改：按需分享，不自动收录）

owner：「不要把月报里的内容直接转到知识库里……会变得很乱。最好局限于当前这个月报内，或者当前技术专区内；他们可以一键分享到 library」。所以：

- 附件（`ZoneReportAsset`）**留在报告里**：报告页 / 帖子页 / 分享页里的文件卡点开是预览 dock 的 `file` 目标（预置数据，PDF 直接在面板里读；office 类给下载卡），中键 / 新标签仍是直链 `/api/zones/media/<key>`。图片走灯箱。可见范围 = 报告 / 帖子本身的可见范围。
- **一键分享**：工具详情页的「附件」卡（`components/reports/ReportAssets.tsx`）对能收录的格式（pdf / epub / html / pptx / docx）给所有者一个「分享到知识库」按钮 → `POST /api/tools/chat-report/[id]/assets/[assetId]/library` → `ingestOneReportAsset`（复制进 library storage → `createDocFromFile`，内容哈希去重）→ `asset.libraryDocId`。之后正文里的「知识库文档」chip 才出现（且要 `LibraryDoc.status = ready`）。
- `ingestReportAssets`（整批）保留给脚本 / 将来的「全部分享」；流水线不再调用，`ingesting` 状态值保留（枚举不删），没有步骤会进入它。
- `listZoneLibraryDocs`（版块「资料」= 本版块报告已分享进知识库的文档）保留，目前没有页面调用——**版块级资料库（把知识库下放到每个版块、可订阅、可一键升级到全站）是下一步的设计**，见 owner 2026-10-21 的要求；在那之前不要再往全站知识库里自动塞东西。

## 6. 权限与限流

| 动作 | 门 |
| --- | --- |
| 新建 / 上传整包 | 登录即可（`/api/tools/chat-report/upload` 只收 `file` kind；媒体库 key 不可猜） |
| 我的列表 | `createdById = 我` |
| 详情 / 看原文 / 导出 | `canSeeReport`；详情里的 `authorMatches` / 名单过身份脱敏 |
| 改标题 / 可见范围 / 重试 / 删除 / 分享到版块 | 所有者（创建者或站级 `zones`）；分享到版块还要在目标版块 `canPost ∥ canModerate`，帖子再过 `createZonePost` 自己的门 |
| 报告模型配置 `/manage/zones/report-llm`、`/api/admin/zones/report-llm{,/test}` | 站级 `zones` 权限（`requirePermission` / `gateApi`），保存走 `logAdmin` |
| 历史 | `canRead`；恢复 = `canEditZonePostContent` |
| 在线编辑者心跳 | `canEditZonePostContent` |
| 限流 | 新建报告 5 次 / 小时 / 人（LLM 成本）；上传 20 次 / 分钟；心跳不限 |

## 7. 文件清单

```
lib/zones/reports/
  schema.ts        zod：cluster / theme / recap / overview / report + validate*（引用校验，可独立测）
  parse.ts         任何形状 JSON / 三种 TXT 行头 / CSV 记录 → messages（parseRawMessages 挑最好的）；manifest CSV；表情码、卡片、um_begin 协议
  infer-format.ts  确定性解析器都认不出时让模型推断行头正则，校验后确定性切分（模型只看格式）
  model-json.ts    模型回复 → JSON（extractJsonObject → JSON.parse → jsonrepair），纯函数
  coerce.ts        模型输出「收，不拒」：coerce / autofix / fallback 四步各一套（§2d），纯函数
  digest.ts        digest 文本 + stats + links（含按天分片）
  slice.ts         主题 bundle 文本
  prompts.ts       四段提示词（与 skill prompts/*.md 同文）
  llm.ts           callJson：provider.complete(json) + 解析 + 校验回贴重试
  assemble.ts      report.json 装配 + 邻域配图
  render-md.ts     report.json → 帖子 Markdown（含 embed 令牌）
  authors.ts       工号 → 用户匹配
  report-view.tsx (components/reports)  ReportViewProvider（时间线展开态）/ ReportMeta / ReportRail / ReportReader（§3a 阅读布局）
  ReportCoauthors.tsx (components/reports)  分享后随时改合著者
  CommentsDrawer.tsx (app/zones/_components/post)  报告帖子的评论抽屉
  bundle.ts        整包上传的识别规则（纯函数，向导与服务端共用）：挑出清单 / 姓名表 / 产物，其余文本全是候选 + 姓名表
  unpack.ts        zip → 每个候选真解析挑最好的 → zone media + ZoneReportAsset + 回写 source/manifest/import/names
  provider.ts      getReportProvider：ZoneReportSetting（沿用知识库 / 单独）→ LLMProvider，60 s 缓存
  pipeline.ts      状态机 + triggerZoneReport + retry + 导入模式 + 第 0 步解包
  sections.ts      原生视图的 section id + 目录（客户端 / 服务端共用，纯函数）
  post-view.ts     post.report：reportJson + 发言人→用户 + 附件→知识库 slug / 媒体 URL
  messages.ts      「看原文」：按 id 取原始消息
  queries.ts       视图、列表、创建、删除、publishZoneReport
  library.ts       附件 → 知识库收录；listZoneLibraryDocs
lib/zones/post-revisions.ts   快照 / 列表 / 恢复
lib/zones/post-presence.ts    心跳 / 活跃编辑者
  visibility.ts    canSeeReport / isReportOwner（一个闸门管所有读）
  resolve.ts       /reports/[slug] 参数解析（slug / id / 退休 slug）
  tool-api.ts      /api/tools/chat-report/* 共用的门
  export-docx.ts / export-pdf.ts   Word（docx 包）/ PDF（soffice）
  writing-guide.ts 向导里「查看默认写法」的文字
lib/tools/catalog.ts   导航「工具」的工具目录（/tools 页与 NAV_MEGA 都读它）
app/api/tools/chat-report/route.ts, upload/route.ts, [reportId]/route.ts, retry/route.ts, publish/route.ts, export/route.ts, coauthors/route.ts
app/tools/page.tsx, chat-report/page.tsx, chat-report/new/page.tsx, chat-report/[reportId]/page.tsx
app/reports/[slug]/page.tsx, messages/page.tsx
components/reports/ReportWizard.tsx, ReportDetail.tsx, ReportList.tsx, ReportArticle.tsx, ReportMessages.tsx, report-bits.tsx
app/api/admin/zones/report-llm/route.ts, test/route.ts；app/manage/zones/report-llm/page.tsx, ReportLlmCard.tsx
app/api/zones/[slug]/posts/[postId]/editors/route.ts, revisions/route.ts, revisions/[revisionId]/route.ts
app/zones/[slug]/posts/[postId]/history/page.tsx
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
10. 版块里**没有**报告入口了（`PostFilters` 的「生成报告」按钮、`/zones/[slug]/reports/*`、`/api/zones/[slug]/reports/*` 都删了）——别加回去；
    版块保留的只有 `post.report` 原生渲染和帖子版本历史 / 并发编辑。
11. 识别看内容、不筛文件：`bundle.ts` 只挑出"肯定不是记录"的，其余文本全是候选，`unpack.ts` 真解析挑最好的，`infer-format.ts` 是最后的模型兜底；`sniffText` 只影响向导里的排序 / 显示，**不要再往它里面加"不像就丢"的规则**。skill 的 `parse-chat.mjs` 目录模式是同一套逻辑的 JS 版（没有模型兜底，报错时把文件开头打出来让 agent 自己转格式）。
13. 模型输出的形状问题不再是错（§2d）：新加一步模型调用时**必须**给 `callJson` 配 `coerce` 和 `onExhausted`，别再写"直接 safeParse、不过就 throw"；zod 的 `.max()` 是上限不是拒绝理由——coerce 里 `clip` 掉。要加字段：schema.ts、coerce.ts（别名 + 截断）、skill 的 validate.mjs / coerce.mjs 四处同改。
15. `/reports/[slug]` 的动态段是**百分号编码**的（App Router 行为），而 `titleSlug` 保留中文，所以 `resolveReportParam` 必须先 `decodeSlugParam`——漏了就是中文标题的报告分享页 / 看原文全 404（2026-10-21）。任何新的 `[slug]` 页都照 `lib/title-slugs.ts` 的做法先解码。
14. 「看原文」「知识库文档」、文件卡都靠 `usePreview()`（右侧 dock），而 PreviewProvider 只挂在 section layout 上：`/zones`、`/library`、`/discussion`，以及 2026-10-21 补的 `/reports`、`/tools`。新开一个会渲染 ReportArticle 的路由，**layout 必须挂 `<PreviewProvider mode="dock">`**，否则 `usePreview()` 是 no-op，按钮点了没有任何反应（分享页上「看原文」没东西就是这个）。
12. 2026-10-20 第三轮的教训：owner 上传的目录是 `*_msgs.json`（agent 自己整理的形状，不是 welink-cli 原样）+ `*_消息记录.txt`，旧规则因为 json 字段名不对就把它当"认不出的 json"丢了，txt 又因为行头少了秒而不认——两边都"像不像"判断、没有一个真去解析，于是报"没有解析到任何消息"。现在三层都是"能解析出消息就用"。
9. TXT 有三种行头版式（`parse.ts` 顶部注释，括号 / 秒 / 分隔符都可变），都是 agent 从 welink-cli JSON 转的；JSON 更全（附件协议块 / 引用卡片），所以整包上传时解析出的 JSON 条数不少于最佳 TXT 的 80% 就优先 JSON——用户目录里 TXT 和 JSON 通常并存。给 agent 的拉取话术在 skill 的 `reference/welink-fetch.md`。
8. `ReportArticle` 是客户端组件：只能 import `sections.ts` 这类纯模块，**不要** import `post-view.ts` / `messages.ts`（它们带 prisma）；类型用 `import type`。
7. welink-cli 不能搬到服务端：它要 WeLink PC 客户端在本机运行 + 手机扫码（约 90 分钟有效）+ 下载附件要绕开公司代理。拉取永远在用户自己的电脑上做，站内只接收结果。
5. 配图只认 `report.attachments[].file` 与 `ZoneReportAsset.name` 的文件名相等（大小写敏感）；清单里的文件名就是云盘下载的文件名。
6. 快照条件和 `editedAt` 完全一致（内容变化且已发布）；草稿自动保存不进历史，否则每次打字都是一版。
7. 409 的判断在 `updateZonePost` 事务里再做一次（`updateMany where revision = base` 守卫写），路由层的预检只是为了给出友好 body。
8. 心跳表要定期清：`PUT` 时顺手删掉本帖 10 分钟没心跳的行；不做定时任务。
