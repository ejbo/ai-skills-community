# 站内翻译 (X 式「翻译 / 显示原文」)

> 设计全文（模型选型、对抗验证、UX 调研、8 个增量）在 [`docs/translation-design.md`](../translation-design.md)。
> 本文只记**已经落地的部分**和它的不变量。2026-09-18 落地了增量 1 + 3 + 5 的核心；没做的列在文末。

Owner:「帖子、知识库、各种讨论、评论都能直接翻译成对应的语言；像 X 那样可以翻译，再加一个 original 的选项；
用户可以配置是总看到对应的语言还是 original」。

- **形状 = X / Mastodon / Slack**：译文是**查看者侧的渲染状态** + 全站共享缓存。永远不写回内容表、不广播、不触发
  通知；「显示原文」永远一键可达，自动翻译的条目也一样。目标语言 = 查看者的界面语言（`viewerLang(locale)`，
  zh-CN→zh / en→en / fr→fr —— **不是**知识库那个把 fr 折进 en 的 `contentLocale`）。
- **客户端从不发送文本**：只发 `{kind, id}`。`lib/translate/sources.ts` 每个 kind 一个加载器，加载器**就是闸门**：自己读行，
  并调用该界面**自己的**列表/详情路由用的那个 helper（`canViewVideo`、`resolveZoneAccess`+`canSeeZonePost`、`canReadDoc`
  + `shareNotes`、投票的 hidden/approved/草稿规则……）——「可读才可译」，null ⇒ 404。所以它既不能拿来读内容，也不能当
  任意文本的免费翻译 API。kind 目录在 `lib/translate/shared.ts#TRANSLATE_KINDS`（13 个）；测试钉死目录 ↔ 加载器双向一致。
  **加一个界面 = 目录加一条 + 一个加载器 + 把渲染包进 `<Translatable/>`**，路由和 UI 不用动。
  - 两处加载器有意不照字面：`library_comment` 镜像的是文档**详情页**的可见性（评论渲染在详情页，restricted 文档的评论对
    所有登录成员可见——用 `canReadDoc` 会出现「看得到评论、点翻译 404」）；`vote_comment` 不看 `allowComments`（关评论只
    收起输入框，已有评论仍可读）。
- **分段与保护 = `lib/translate/markdown.ts`**（纯函数，`tests/translate-markdown.test.ts`）。两条让它结实的规则：
  1. **结构是我们的**：标题 `#`、列表/任务标记、`>` 层级、表格竖线在送给模型**之前**切掉、之后粘回。模型看不到列表和表格，
     也就弄不坏它们。表格按单元格、列表按条目、普通段落整段（保留跨句上下文）成为一个 unit。
  2. **一切不透明的东西都是占位符 ⟦n⟧**：行内代码、链接目的地（`]` 留在文本里，`restore` 会合上模型在 `]` 和占位符之间加的
     空格）、整张图片、`[@名字](/users/x)` 提及、原始 HTML 标签（`<span data-color>`、`<br>`）、URL、脚注、源文里的字面 ⟦⟧。
     字面括号规则必须排**第一**（否则会吞掉后面规则铸出的真占位符）。
  独占一行的 `[poll:]` / `[embed:]`、围栏代码、纯图片行、纯 HTML 行（`<div data-lh>`）、表格对齐行、分隔线是**不透明块**，
  逐字节原样输出——投票组件/嵌入卡照常挂载，`collectEmbedRefs(译文) === collectEmbedRefs(原文)`，服务端预解析的 embed 继续命中。
  恒等式：`segment(x).chunks.map(c => c.raw).join('') === x`。
- **输出守卫 = `lib/translate/guards.ts`**。第一条是安全守卫：因为源文里所有 URL/标签/链接/代码都已经是占位符，模型的
  **原始回复**里出现反引号、`](`、HTML 标签、URL scheme、`[poll:`/`[embed:`、`![` 任何一个，都只能是模型编的——或者是
  **作者埋的提示注入**（译文是以被替换内容的信任级别渲染的）。命中即整块作废、保留原文。其余：占位符恒等（每个恰好一次）、
  回声、目标语言复检、长度比、强调符配对。失败从不报错：该 unit 保留原文，条目标 `partial`。
- **引擎 = `lib/translate/engine.ts`**：缓存 →（跨请求 in-flight 去重：二十个人同时点同一段 = 一次模型调用）→ 翻译专用
  信号量（知识库回退时最多 2 路，不和知识库问答抢那 6 个槽）→ `stripReasoning` → 守卫 → 重试一次 → 写缓存。守卫两次都
  不过的 unit 记 30 分钟负缓存（不会每次有人看都重试）。每次调用自带 `TRANSLATE_RUN_TIMEOUT_MS`（默认 45 s），条目过
  50 s 就先返回已有的（`partial`，再点一次从缓存补齐）。**不设 `maxTokens`**（全站家法）。
  两种提示词形状（`prompts.ts`）：`general` = 12 段一批的按序号 JSON（知识库那套 + fr + 占位符规则，
  `parseTranslatedPassages` 解析）；`mt` = 一段一调的纯文本（Hy-MT2 官方提示词）。
- **缓存 = `ContentTranslation`**（migration `20260918120000_content_translation`）：键 = 目标语言 + **原始 unit 文本**
  （空白归一、占位符**未**替换）的 sha256，值 = 已还原的译文。内容一改哈希就变，无需失效逻辑；占位符样式可以换而不废缓存；
  键里没有条目 id，缓存行无法按条目枚举。存 `model` 是为了将来按模型清空。
- **路由**：`POST /api/translate {kind,id,target?}` 先跑一遍**只读缓存**——全命中在限流器和 provider 解析**之前**就回答，
  第二个读者不花任何东西；只有 miss 才需要登录、扣一次额度（120 次/小时/人，失败退还）、调模型。匿名只能在 public kind 上
  拿缓存命中（miss ⇒ 202 `pending`，**匿名流量永远花不到 GPU**）。`POST /api/translate/batch`（≤30 条）**永远只读缓存**，
  是自动翻译的快路径；没缓存的回 `pending`，由客户端逐条走单条路由。`GET /api/translate/status`、
  `GET|PUT /api/settings/translation`。
- **提供方槽位 = `lib/translate/provider.ts`**：`TRANSLATE_LLM_BASE_URL`+`TRANSLATE_LLM_MODEL`（专用模型，建议非推理 MT 模型，
  `TRANSLATE_LLM_KIND=mt`）→ 否则回退知识库模型（`general`；**只有开了「关闭思考」才可接受**，推理模型会把 0.5 s 的翻译
  变成 10–30 s）。`TRANSLATE_ENABLED=false` 是总开关。**没有引擎时全站不渲染「翻译」链接**（能力标志，不是死按钮）：
  `app/layout.tsx` 用 `loadTranslatePrefs`（永不抛错、引擎状态 60 s 缓存、登录用户一次两列读取）把
  `{available, engine, viewerLang, signedIn, autoTranslate, skipLangs}` 播种进 `<TranslatePrefsProvider/>`。
- **UI 只有一个组件，不许按界面 fork**（点赞按钮的教训）：
  - `components/translate/Translatable.tsx` —— render-prop，给 `t.title/summary/body`（当前该渲染的文本）、`t.ref`
    （挂在条目容器上，自动翻译等它接近视口）、`t.control`（翻译 / 翻译中… / 显示译文）、`t.note`
    （「译自{lang} · {engine} · 显示原文 · ⚙」，只在显示译文时出现）。界面保留自己的渲染器，只换文本。
  - `TranslatableScope.tsx` —— 给**服务端渲染**的详情页用（RSC 不能把函数子节点传给客户端组件）：一个作用域 +
    `<TranslatedText field/>`、`<TranslateNote/>`、`<TranslateControl/>`、`useTranslated()` 几个客户端叶子。
  - 是否显示链接由 props + 服务端播种的 context 经**纯函数**决定（`detectContentLang`/`hasTranslatableText`，
    `lib/translate/detect.ts`，两端同一份）——SSR 与水合一致，无需 mounted 闸门。语言**不存库**：改进启发式即对所有存量生效。
  - ⚙ 里是「自动翻译」开关和「不翻译{lang}」（X 用户最想要的逃生口）；面板走 `useAnchoredPanel` portal（卡片是
    `overflow-hidden` / `card-hover` transform）。chrome 全墨：安静的文字链接 + 一行灰色说明，无药丸、无强调色、无 ✨。
    `tone`: `default` / `reader`（知识库阅读器自己的主题）/ `onDark`（投票灯箱、短视频）。
  - 浏览器侧请求层 `translate-client.ts`：结果缓存键 `kind:id:target:fnv1a(text)`（就地编辑后不会显示旧译文）、单条请求
    最多 3 路并发、自动翻译 150 ms 合并成一次 batch。自动翻译失败**静默**（手动链接还在）。
  - **自动翻译的 effect 里，条目容器放在 ref 里而不是 state 里，在途请求绝不因 effect 重跑而取消。** 第一版用 state：
    callback ref 触发的 setState 晚一个 render 才到，effect 第一次跑看到的是 `null` → 立刻发请求 → 容器到了、effect 重跑、
    cleanup 把结果判了 `cancelled`，而 `autoTried` 已经置位 → 永远不会再请求。现象是「自动翻译什么都不翻」，单测测不出来，
    是真机点出来的。能丢弃结果的只有两件事：条目变了（`settle` 比较 `askRef`）或组件卸载。
  - 自动翻译下，重新挂载的条目（信息流预览换成完整评论串、抽屉重开）如果页面内已有译文，**直接显示译文**
    （reset effect 里 `setShowing(known ok && autoTranslate)`）；切换开关也会重跑：开 = 亮出已缓存的，关 = 回到原文。
  - 摆放的经验法则：**评论** = 说明行在正文上方、翻译链接在操作行末尾（操作行一律 `flex-wrap`，375 px 能换行）；
    **长文详情页** = 说明行和翻译链接共用正文正上方同一个位置（操作栏在手机上已经排满，且在全文之后）。
    `t.ref` 直接挂在正文外层容器上，不要拿内联 callback ref 去和已有的 `useRef` 合并。
  - 技术专区帖子显示译文时，`PostRail` 用同一个 `extractHeadings(译文)` 重算目录（`ZoneMarkdown` 本来就按渲染文本重新分配
    标题 id），目录、点击跳转、当前章节高亮都跟着译文走；切回原文用服务端的 `post.headings`。草稿 `disabled`（每次自动保存都会
    产生没人读的缓存行）；锁定存根在进入 scope 之前就返回。`CommunityNotePopover` 的「点外部关闭」对 `role="menu"` 放行——
    ⚙ 菜单是 portal 到 body 的，否则点菜单项之前弹层就先关了。
- **用户设置**（`User.autoTranslate` 默认 **关** —— X 默认开且没有总开关是它被骂最多的一点；`User.translateSkipLangs`）：
  设置 → 语言 →「内容翻译」（`AutoTranslateForm`：总是显示译文 / 显示原文需要时再翻译 + 不需要翻译的语言）与每条译文上的
  ⚙ 读写同一个 context，改了立即对页面上所有条目生效。账号级设置（跨设备），不是 cookie。
- **永不翻译**：姓名/handle、`DeptTag`、标签、日期、`[poll:]`/`[embed:]` 卡片、代码、表情包、媒体文件名；列表行/摘要/热榜
  保持原文（X 翻译条目，不翻译索引）；知识库章节仍走自己的译文管线（`lib/library/translate-doc.ts`），批注的 `quote`
  锚定原文，不翻。

**还没做（设计文档里的后续增量）**：专用 MT 模型部署（增量 0，运维）；后台设置卡 + 健康自检 + 按模型清空（增量 2）；写入时
预热（增量 4）；条目级缓存 + 自动翻译 SSR 直出（现在缓存命中的条目水合后才换，会闪一下原文）；「翻译有误」反馈；术语表；
把字幕和知识库两套翻译器并到这个引擎上（增量 7）；超过 `MAX_ITEM_CHARS`（24k）的长文（413）。
