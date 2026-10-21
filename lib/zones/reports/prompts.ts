// 版块报告 — 四段提示词（与 skill prompts/0{1,2,3,4}-*.md 同文；改措辞两边同改）。
// 每段只要求模型输出一个 JSON 对象；铁律：只引用消息 id、url 只能来自记录、不编造、不硬凑。

export const REPORT_SYSTEM_PROMPT = '你是严谨的技术情报编辑。只输出一个 JSON 对象，不要任何解释文字，不要注释，不要尾逗号。';

/** 用户在向导里填的补充要求（docs/contracts/reports.md §2b）。 */
export interface ReportInstructions {
  text: string;
  /** append = 加在默认写法之后、优先于默认写法；override = 取代默认写法里关于取舍与文风的部分。 */
  mode: 'append' | 'override';
}

/**
 * 把用户要求插进提示词「## 输出格式」之前：两种模式都明确告诉模型——字段、JSON 形状、引用校验
 * （msgRefs / sources 只能来自记录、不编造）永远不变，变的只是内容取舍与文风。
 */
export function withInstructions(prompt: string, ins?: ReportInstructions | null): string {
  const text = ins?.text.trim();
  if (!text) return prompt;
  const block =
    ins!.mode === 'override'
      ? `## 用户的写作要求（取代上面关于内容取舍、详略与文风的说明）\n\n${text}\n\n> 字段名、JSON 形状、「铁律」与引用校验（msgRefs / sources / speaker 只能来自原始消息，不编造）仍然必须遵守。\n\n`
      : `## 用户的补充要求（优先于上面的写法；字段、输出格式与铁律不变）\n\n${text}\n\n`;
  const i = prompt.indexOf('## 输出格式');
  return i >= 0 ? prompt.slice(0, i) + block + prompt.slice(i) : `${prompt}\n\n${block}`;
}

export function clusterPrompt(digest: string, ins?: ReportInstructions | null): string {
  return withInstructions(`你是一名技术情报编辑。下面是一段群聊摘录（每行一条消息，行首 \`mN\` 是消息 id）。请把**有信息量的消息**归到 3–8 个「大主题」里，再把活动通知、非科研花絮、无信息量的分别挑出来。

## 规则（必须遵守）

1. **只引用 id**，不要抄正文。每条消息最多归入一个主题；活动通知放 \`events\`，非科研/生活/终端产品花絮放 \`recap\`，寒暄、纯链接无说明、重复转发放 \`skip\`。
2. **主题要大而稳**：按「研究方向 / 技术赛道 / 产业动态」分，不按天分、不按人分。同一件事的提出、回应、质疑、后续链接都归同一主题。主题数 3–8 个，每个主题 ≥ 3 条消息；太小的并进相近主题。
3. **覆盖率要高**：摘录里每一条消息都要出现在 \`themes / events / recap / skip\` 之一。校验器会检查覆盖率 ≥ 85%。
4. \`title\` ≤ 20 字，是「名词短语：关键词」，例：\`互连与封装：MicroLED、玻璃基板\`；\`tagline\` 一句话说清这个主题本期在讨论什么（≤ 60 字）。
5. **不要编造**：不知道的不写，不要推断摘录里没有的信息。
6. 输出**只能是一个 JSON 对象**，不要注释，不要尾逗号。

## 输出格式

{"themes":[{"id":"t1","title":"主题一标题","tagline":"一句话定位","msgIds":["m1","m2"]}],"events":["m37"],"recap":["m22"],"skip":["m5"]}

## 聊天摘录

${digest}`, ins);
}

export function mergeClustersPrompt(parts: string[]): string {
  return `下面是同一群聊不同时间段各自聚出的主题列表。请**合并语义相同/相近的主题**（合并后 \`msgIds\` 取并集），给合并后的主题重新编号 t1…，保留 \`events / recap / skip\` 的并集。主题数 3–8 个。输出格式：

{"themes":[{"id":"t1","title":"…","tagline":"…","msgIds":["m1"]}],"events":[],"recap":[],"skip":[]}

只输出 JSON。

${parts.map((p, i) => `## 第 ${i + 1} 份\n${p}`).join('\n\n')}`;
}

export function themePrompt(bundle: string, ins?: ReportInstructions | null): string {
  return withInstructions(`你是一名技术情报编辑，正在为一份内部「技术动态报告」写其中一个主题。下面是这个主题的全部原始消息（全文、按时间）。请写出这个主题的结构化摘要。

## 写法

- **tagline（主题定位）**：一句话（≤ 60 字），说清这个主题本期在讨论什么、为什么重要。
- **macro（宏观总结）**：1–4 条，每条一个标签 + 一两句话。标签只能用：\`共识\`（大家都认同的）、\`分歧\`（谁和谁观点不同，各说什么）、\`判断\`（某人给出的明确判断）、\`格局\`（业界/产业动态）、\`杠杆\`（关键的技术抓手）、\`风险\`、\`进展\`（内部或业界的实际进展）。把具体数字、公司名、人名写进去。
- **viewpoints（观点时间线）**：按时间顺序，2–12 条。**一条观点 = 一个人在一段时间里表达的一个意思**；同一人连续几条消息说同一件事要合并成一条；别人简短的回应可以写进这条的 text 里（如「崔弘飞回应：…」）。每条：
  - \`speaker\` / \`account\`：必须与原始消息里的「姓名（账号）」完全一致，不能自己起名。
  - \`date\`：这条观点第一条消息的日期 \`YYYY-MM-DD\`。
  - \`role\`：\`提出\` / \`回应\` / \`质疑\` / \`补充\` / \`判断\` / \`进展\` / \`结论\` / \`通知\` 之一。
  - \`text\`：≤ 200 字，用自己的话概括，**保留关键数字、名词、立场**；是转发/转述要写明「转 …」。把这条观点里**最关键的 1–2 个词或短语**（模型名、数字、结论词）用 \`**…**\` 包起来，渲染时会高亮；不要整句加粗。
  - \`quote\`（可选）：≤ 120 字的原话，只在原话本身有分量时才给。
  - \`sources\`：引用的链接 **只能从「本主题出现的链接」里选**，\`label\` 写成「平台 · 标题」（如 \`arXiv 2510.03215\`、\`X · PhotonCap\`、\`3MS · 报告名\`）；没有链接就写 \`[{"label":"群内观点"}]\`，转述别人资料写 \`群内转述（XX 资料）\`。
  - \`msgRefs\`：这条观点概括了哪些消息 id（≥ 1，必须来自本主题，至少一条是该发言人自己发的）。你引用的 id 会被校验，写错会被打回。
- **conclusion（结论）**：一句对决策有用的收束判断或建议（≤ 150 字）。**如果这个主题只是信息罗列、没有可下的结论，就写 null**，不要硬凑。
- **openQuestions（待验证 / 待跟踪）**：0–4 条，讨论里没有答案但值得跟进的问题。
- **resources（本主题资料）**：把值得存档的论文 / 代码 / 文章 / 内部资料列出来，\`kind\` 只能是 \`paper / repo / article / internal / video / doc / other\`；url 同样只能从链接列表里选。

## 铁律

1. **不编造**：没在消息里出现的事实、数字、链接、人名一律不写。拿不准就少写。
2. 不评价发言人，不加「值得注意的是」之类的废话，不复述整段原文。
3. 输出**只能是一个 JSON 对象**，不要注释，不要尾逗号，字符串里的双引号要转义。

## 输出格式

{"id":"t1","title":"主题标题（可沿用）","tagline":"一句话定位","macro":[{"tag":"共识","text":"……"}],"viewpoints":[{"speaker":"李思昊","account":"l00974474","date":"2026-09-16","role":"提出","text":"……","quote":"……","sources":[{"label":"X · Jev","url":"https://x.com/..."}],"msgRefs":["m12","m13"]}],"conclusion":"……或 null","openQuestions":["……"],"resources":[{"label":"……","url":"https://…","kind":"paper"}]}

## 主题原始消息

${bundle}`, ins);
}

export function recapPrompt(events: string | null, recap: string | null, ins?: ReportInstructions | null): string {
  return withInstructions(`你是一名技术情报编辑。下面两段分别是群聊里的「活动通知」和「非科研花絮」消息。请整理成结构化 JSON。

## events（活动与通知）
每个活动一条：\`title\`（活动名，带期数/地点，≤ 60 字）、\`date\`（活动举办日期 \`YYYY-MM-DD\`；消息里只给了月日就按消息年份补全；完全没有日期写 null）、\`host\`（主办或群内发起人）、\`url\`（报名/详情链接，只能用消息里出现过的；没有写 null）、\`note\`（一句话：议题 / 要求 / 群内安排，≤ 80 字，可 null）、\`msgRefs\`（相关消息 id）。同一活动的多条消息（通知 + 报名讨论 + 求票）合并成一条。

## recap（非科研 · 快速 Recap）
每条花絮一条：\`text\`（≤ 100 字，概括事实 + 群内反应）、\`msgRefs\`、\`sources\`（有链接才写，否则 \`[{"label":"群内观点"}]\`）。\`title\` 固定为「非科研 · 快速 Recap」。没有花絮消息时 \`recap\` 写 null。

## 铁律
不编造；只能引用给出的消息 id 和出现过的链接；只输出一个 JSON 对象。

## 输出格式
{"recap":{"title":"非科研 · 快速 Recap","items":[{"text":"……","msgRefs":["m22"],"sources":[{"label":"群内观点"}]}]},"events":[{"title":"……","date":"2026-09-25","host":"……","url":null,"note":"……","msgRefs":["m74"]}]}

## 活动通知消息
${events ?? '（无）'}

## 非科研花絮消息
${recap ?? '（无）'}`, ins);
}

export function overviewPrompt(summary: string, ins?: ReportInstructions | null): string {
  return withInstructions(`你是一名技术情报主编。下面是本期报告各主题的提纲（已经写好）。请在此基础上写「本期要点」——这是读者打开报告看到的第一屏，要让忙碌的负责人 1 分钟内知道本期发生了什么、意味着什么、要做什么。

## 要写的四样

1. \`headline\`：一句话主线（≤ 50 字）。不是罗列主题，而是说出本期各主题背后共同的趋势或张力。
2. \`highlights\`：3–6 条要点，每条 ≤ 70 字，一条对应一个主题（\`themeId\`），写**事实 + 为什么重要**。按重要性排序，而不是按主题编号。每条用 \`**…**\` 标出 1 个关键词（渲染时高亮），\`headline\` 和 \`judgments\` 同样。
3. \`judgments\`：1–5 条关键判断，每条是一个可被证伪的命题（≤ 60 字），带 \`confidence\`：\`high\`（多人共识或有实证）/ \`medium\`（有理有据但待验证）/ \`low\`（个人猜测）。写明 \`themeId\`。
4. \`actions\`：0–8 条待办/跟踪事项，**只写讨论里明确提出或自然推出的事**，每条带 \`owner\`（讨论里被点名/认领的人，写姓名；没有就 null）、\`ownerAccount\`（该人的账号，提纲里有就写，没有 null）、\`themeId\`（可 null）、\`due\`（有明确日期才写 \`YYYY-MM-DD\`，否则 null）。

## 铁律
- 所有内容只能来自提纲，不加新事实、不加新链接。
- 直接、具体、有数字；不要「值得关注」「意义重大」这类空话。
- 只输出一个 JSON 对象。

## 输出格式
{"headline":"……","highlights":[{"text":"……","themeId":"t1"}],"judgments":[{"text":"……","themeId":"t2","confidence":"high"}],"actions":[{"text":"……","owner":"周春华","ownerAccount":"z00885012","themeId":"t4","due":null}]}

## 各主题提纲
${summary}`, ins);
}
