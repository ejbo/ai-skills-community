# 讲稿 · Internal models & AI Community（20 分钟）

怎么用：每页给你三样 —— 时间、中文提纲（自己看的）、`SAY` 是可以直接念的英文。
`▸` 是动作提示。英文口语约 1,800 词，念完约 13 分钟，加上停顿、指屏幕、有人插话，差不多 18 分钟。

**别背稿。** 记住下面这 8 句，剩下用自己的话讲就行。

| 页 | 记住这一句 |
|---|---|
| 1 | 今天两件事：内部模型，和 AI Community |
| 2 | 五个模型在内网，一个 endpoint，你的工具接上就能用 |
| 3 | 已经有团队在用了，不是 demo |
| 4 | Skill 就是你调好的那套东西，传上来别人就不用再写一遍 |
| 5 | 好文章好视频大家各看各的，凑到一起才看得全 |
| 6 | 请个专家来讲，结果一半该听的人根本不知道 |
| 7 | 我们要的是你们真的用，然后告诉我们哪儿不行 |
| 8 | 谢谢，会后我可以直接帮你配好 |

---

## 1 · Two things ⏱ 1:00

中文提纲：开场，说清今天分两块，第二块讲完还有两分钟是给他们的。

> **SAY**
> I'll keep this to twenty minutes. Two things, both already running.
>
> The first is the internal models. We host five of them on our own network. Any team can use them —
> you don't need to ask anyone, and nothing you send goes outside. I'll show you which models,
> how to connect, and what a few teams have already built with it.
>
> The second is the AI Community. That's where we put the things we work out, so the next person
> can find them instead of doing it again. Skills, articles and papers, videos, discussion, events.
>
> And at the end I'll ask you for something, so don't leave early.
>
> Stop me any time — I'd rather answer as we go.

`▸` 最后那句 "don't leave early" 说得轻松点，是个玩笑，能让场子松下来。

---

## 2 · Internal models ⏱ 4:00

中文提纲：五个模型 + 三种接法 + wiki 在哪 + 配额。这是 Part 1 的核心，慢慢讲。

> **SAY**
> So, five models running internally.
>
> GPT-OSS is the one most people start with — general chat and code, and it's fine for most things.
> GLM-5.1 is the strongest of the local ones; use it when the task actually needs reasoning.
> GLM-4.6V reads images, so screenshots, diagrams, scanned pages. MiniMax handles long documents.
> And Gemma 4 is small and fast — if you're running something over thousands of items, use that one.
>
> These all sit on the internal network. Two things follow from that. You don't configure a proxy.
> And whatever you send doesn't leave. For a lot of internal material that's the difference between
> being able to use a model and not.
>
> There are three ways in.
>
> From code, it's one base URL and the normal OpenAI SDK. If you've written anything against OpenAI
> before, you change the base URL and the model name and you're done.
>
> From the browser, there's the multi-model chat on ai4news. You pick several models, ask once, and
> the answers come back side by side. That's actually the fastest way to work out whether one of our
> models is good enough for your task — you put in your own real prompt and look at the answers,
> rather than reading a benchmark someone else ran.
>
> And from a coding agent — Claude Code, Cline, Continue, Cursor, whatever you use. If it takes an
> OpenAI base URL, it works.
>
> The links are on the wiki, and I'll put them in the chat after.
>
> One practical thing: usage is per person with a daily token budget. So nobody's sharing a key,
> and nobody's going to get a surprise at the end of the month.

`▸`
- 五个模型别一个个念完，念两三个然后说 "the rest are on the slide"，手指一下表格。
- 「nothing leaves the network」这句要停一下，很多团队卡的就是这个。
- wiki 那三个占位符 **讲之前一定要填**，不然当场很尴尬。
- 有人问延迟/并发/成本：说"看具体模型，会后单独聊"，别在这儿展开。

---

## 3 · What teams built ⏱ 3:00

中文提纲：三个团队的实际使用。这一页你自己最清楚，按实际情况讲，我写的只是骨架。

> **SAY**
> This isn't a demo — these are three things people needed done anyway.
>
> *(点第一张图)* This team pointed a coding agent at the internal model and worked through an old
> codebase with it. **&lt;说你知道的：改了多少、省了多久、遇到什么&gt;**
>
> *(第二张)* This one ran their own task set against several models before picking one to build on.
> **&lt;他们的结论是什么&gt;**
>
> *(第三张)* And this team used the hosted models as a baseline while training their own.
> **&lt;结果&gt;**
>
> The thing worth noticing: none of them filed a request. No key, no quota, no deployment ticket.
> They pointed their tool at the endpoint and started that afternoon.
>
> If your team's doing something like this, tell me — I'd rather have your screenshot on this slide
> than mine.

`▸`
- **三张图必须提前放进去**，用编辑模式粘贴（点「Enter edit」，Ctrl+V）。空着讲会很虚。
- 尖括号里的内容换成你真的知道的。数字比形容词有用 —— "两周的活儿三天做完" 比 "效率提升明显" 强得多。
- 如果只有一个团队的材料，就删掉另外两张，别硬凑。

---

## 4 · Skills Center ⏱ 4:00

中文提纲：先说 skill 是什么（很多人不知道），再两个例子，再详情页，最后 CLI。

> **SAY**
> Now the second half.
>
> A skill is basically a folder you hand to an agent. It says what to do, when to do it, and which
> conventions to follow. Most of you probably have two or three that work really well — and they're
> sitting in a folder on your laptop.
>
> Two of ours, as examples.
>
> The first is Huawei SSO. W3 login — there's a Django version, an Auth.js provider for Next.js,
> and the raw OAuth2 flow if you're on something else. It also carries all the traps we hit deploying
> under a subpath behind nginx, which cost us about a week the first time. Nobody should pay that
> twice.
>
> The second one writes decks in our internal report style. These slides were made with it.
>
> On a skill's page you get eight tabs, and the point of most of them is the same: let you decide
> whether to install it without installing it. You can read every file in the package. You can see
> the version history. You can see what other people rated it. Composition shows what people tend to
> install alongside it. Comparison is the same task run with and without the skill. And Playground
> lets you just talk to an assistant that already has it loaded.
>
> A few other things. You can publish public, restricted, or private — restricted means everyone can
> see what it is, but you approve each download, so something with internal process in it can still
> go up. You can Remix someone else's: copy it, change it, publish as yours, and the original gets
> credited. And if you own one you can see who's using it — downloads, how many distinct people,
> which version they're on.
>
> Installing is one command.

`▸`
- "sitting in a folder on your laptop" 说完停一下，扫一眼下面，多半有人点头。
- 八个 tab 别一个个念，说三四个然后 "the rest are on the slide"。
- 「These slides were made with it」是个小彩蛋，能拉一点信任。
- 有人问「和 prompt 模板有什么区别」：答"skill 是一个目录，可以带脚本和多个文件，而且带触发条件，agent 自己知道什么时候用"。

---

## 5 · Library & Geek Hub ⏱ 3:00

中文提纲：初衷是"各看各的看不全"。然后是怎么用。Geek Hub 同理。

> **SAY**
> Library first.
>
> This field moves fast and the good material is scattered everywhere — blogs, arXiv, newsletters,
> internal reports. Each of us finds a few good ones. Nobody sees the whole picture on their own.
> The idea here is just: if everyone drops the good ones in one place, everyone ends up with a
> better reading list than they'd put together alone.
>
> You paste a link or upload a PDF. The text gets pulled out, and the AI writes a summary
> chapter by chapter, so you can tell whether it's worth an hour before you commit one.
>
> Then you can highlight and annotate as you read. Those are private by default — but if you turn
> them on, other people see them in the margin and can reply to your note on that paragraph.
> That part is more useful than it sounds. Somebody else's question next to a paragraph you
> also found confusing saves you a lot of time.
>
> And you can put things on your shelf; it remembers where you stopped.
>
> Geek Hub is the same idea for video. Our own sessions, plus good external talks people find.
> A link in a chat is gone the next day. Here it stays, with the discussion under it.
>
> Each video gets an AI summary — one line plus the key points — so you can decide in half a minute
> whether to watch the hour. And you can ask questions about that specific video; the answers come
> from that talk only, and if it wasn't covered it tells you rather than making something up.

`▸`
- 「Somebody else's question next to a paragraph you also found confusing」这句是这页最好的点，说慢一点。
- Geek Hub 现在还没什么内容，**别假装它很满**。如果有人问，就说"刚起步，正在往里放"。
- 时间紧的话这一页可以压到 2 分钟。

---

## 6 · Discussion & Events ⏱ 3:30

中文提纲：Discussion 两块，快速带过。Events 是重点 —— 讲那个"请了专家结果没人知道"的痛点，然后指对比图。

> **SAY**
> Discussion has two halves.
>
> The feed is for short things — something you tried this afternoon, a screenshot, a link, an AI event
> worth flagging. It's closer to a moments feed than a forum. Images, video, files all work, and people
> react and comment.
>
> Topics are the longer threads. A new model comes out and we argue about whether it's worth switching.
> Someone's writing a paper and wants to think out loud about it. Those are filed by board, so they're
> still findable in six months, which a chat thread isn't.
>
> Now Events — and this one I feel more strongly about.
>
> We put real effort into getting a professor or an expert to come and speak. Somebody spends weeks
> on it. And then it goes out in one mailing list and a couple of group chats.
>
> If you're in another lab you often just never hear about it. Sometimes people in the *same* lab
> don't hear about it. The talk happens, twelve people show up, and half the people who would
> actually have wanted it were never told. That's a waste of the effort that went into arranging it.
>
> *(指对比图)* On the left, that's how it goes out today. One list. No time zone. Nothing you can
> search next month.
>
> On the right is the same thing on the events page. Everyone can see it, not just the list it was
> sent to — cross-lab, cross-institute. You can filter by date, by topic, by city, by whether it's
> online. Times show in your own zone with the original in brackets. And past events stay there,
> so you can go back and see who spoke on what.
>
> Anyone can publish one, by the way. It doesn't have to come from an organising committee.
> A reading group counts.

`▸`
- 「twelve people show up」这种具体数字比"很多人错过"有力，可以换成你知道的真实情况。
- 对比图是这一页的重点，**手要指**：先指左边邮件，再指右边页面。
- 如果在场有人办过活动，可以直接看着他说 "you've had this happen"。

---

## 7 · Get involved ⏱ 3:00

中文提纲：全场的目的。三件事，一件比一件重。然后说清"你反馈了会怎样"。

> **SAY**
> Last slide, and this is the actual reason I asked for the time.
>
> All of this is built. Whether it's worth keeping running depends on how many teams actually use it.
> Right now that number is small.
>
> Three things, and the first one is genuinely small.
>
> Try one thing this week. Point an agent at the internal model. Install one skill. Or take the next
> paper you have to read and put it in the Library instead of your downloads folder. Ten minutes.
>
> Second, tell us what's missing. Which model you need and can't get. What broke. What you went
> looking for and couldn't find. That's the part we can't do ourselves — we don't know what you
> tried and gave up on.
>
> Third, if your team has something worth sharing — a skill, a model endpoint you want reachable,
> a talk worth recording — bring it and we'll help with the wiring.
>
> And to be concrete about what happens when you tell us something, because "give us feedback" is
> usually where these talks end and nothing follows.
>
> If you say you need a specific model, we deploy it internally or turn it on at the gateway.
> That's a config change, so it's days.
> If you say something's broken or missing, it goes on the list with your name on it, and small
> things get done that week.
> And if you say your team already built something, we'll help you publish it so the other teams
> stop building it again.

`▸`
- 「Right now that number is small」—— 诚实说，别夸大。夸大了下面坐着的人心里有数。
- 三件事一件一件讲，讲完一件停一下。
- 最后三条"你说 X → 我们做 Y"要说得肯定，这是承诺，讲完就得做到。

---

## 8 · Thank you ⏱ 0:30

> **SAY**
> That's it. Happy to take questions. And if you'd rather just try it than ask about it,
> come find me after and I'll get you set up in five minutes.

---

## 可能会被问的问题

| 问题 | 怎么答 |
|---|---|
| 内部模型比 GPT / Claude 差多少？ | 看任务。有些够用，有些明显不够。别下结论 —— 让他去多模型对话里用自己的 prompt 试，这比你说什么都管用。 |
| 数据安全？ | 内部模型在内网，请求不出网。外部 provider 走公司代理。内容可见性是逐条设的：公开 / 需申请 / 私有。 |
| 要不要申请配额？多少钱？ | 按人有每日 token 上限。默认用共享 key，也可以自己配。**具体额度讲之前先确认一下**。 |
| 我们组已经有类似的东西了 | 最好的回答：那正好，发上来别的组就不用再造。当场记下这个人的名字，会后找他。 |
| 接进去要多久？ | 一个 base URL 一个 key，OpenAI 兼容。真接不上我们帮你接。 |
| 谁维护？会不会做一半黄了？ | 别过度承诺。说清现在谁在维护、投入多少。 |
| Skill 里有内部流程能传吗？ | 设成 restricted：介绍所有人可见，下载要你本人批。 |
| Geek Hub 怎么没什么内容？ | 直说刚起步。顺势请他们贡献。 |

## 时间检查

| 到这个时间 | 应该在讲 |
|---|---|
| 5 分钟 | 内部模型讲完，正翻到「团队在用什么」 |
| 8 分钟 | Part 1 结束 |
| 12 分钟 | Skills 讲完 |
| 15 分钟 | Library / Geek Hub 讲完 |
| 18 分钟 | Events 讲完 |
| 20 分钟 | 参与那页讲完，进 Q&A |

超时就砍 Library / Geek Hub 那页，压到一分钟。
**不要砍**：团队使用那页（唯一的证据）、Events 的痛点、最后的参与页。

## 讲之前的检查清单

- [ ] 第 2 页三个 wiki 占位符填好
- [ ] 第 3 页三张团队截图放进去，尖括号里的内容换成真的
- [ ] 第 5 页 Geek Hub 截图（有内容了就换掉占位框，没有就删掉那个框）
- [ ] 第 7 页三条承诺，确认你说了能算数
- [ ] 内部模型的日配额数字，确认现在是多少
