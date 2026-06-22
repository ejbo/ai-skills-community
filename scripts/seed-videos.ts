// Demo seeder for the video board. Downloads SHORT public sample clips + posters
// into LOCAL storage (./storage/videos) and serves them via /api/videos/file —
// so demos play from your own server with NO external runtime dependency (works
// on an intranet too). Idempotent (assets cached; comments reset per video).
// Run: pnpm exec tsx scripts/seed-videos.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

const prisma = new PrismaClient();

// Local object-storage root the app serves from (must match lib/video/storage).
const STORAGE_VIDEOS = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR || './storage', 'videos');

// Download an asset to local disk once (idempotent). Returns the storage key.
async function fetchToLocal(url: string, key: string, minBytes = 500): Promise<string> {
  const dest = path.join(STORAGE_VIDEOS, key);
  try {
    if (fs.existsSync(dest) && fs.statSync(dest).size >= minBytes) return key;
  } catch {
    /* fall through and (re)download */
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`fetch ${url} -> ${res.status}`);
  const ws = fs.createWriteStream(dest);
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>).pipe(ws);
    ws.on('finish', () => resolve());
    ws.on('error', reject);
  });
  return key;
}

const POSTER_SRC = (seed: string) => `https://picsum.photos/seed/${seed}/960/540`;
// A labelled "figure/diagram" placeholder used inside descriptions.
const FIG = (text: string, alt: string) =>
  `![${alt}](https://placehold.co/960x420/0f172a/e2e8f0/png?text=${encodeURIComponent(text)})`;

const CATEGORIES = [
  { slug: 'llm', name: '大模型', sortOrder: 1 },
  { slug: 'agent', name: 'Agent', sortOrder: 2 },
  { slug: 'infra', name: '算力 / 推理系统', sortOrder: 3 },
  { slug: 'embodied', name: '具身智能', sortOrder: 4 },
  { slug: 'multimodal', name: '多模态', sortOrder: 5 },
];

// Reliable, public, range-enabled short MP4 sources (verified 200/206).
const BBB360 = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4';
const BBB720 = 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_2MB.mp4';
const JELLY = 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/360/Jellyfish_360_10s_1MB.mp4';
const SINTEL = 'https://test-videos.co.uk/vids/sintel/mp4/h264/360/Sintel_360_10s_1MB.mp4';
const FLOWER = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const W3BBB = 'https://www.w3schools.com/html/mov_bbb.mp4';

function mediumDesc(o: { intro: string; points: string[]; figText: string; figAlt: string }): string {
  return [
    o.intro,
    '',
    '## 关键看点',
    '',
    ...o.points.map((p) => `- ${p}`),
    '',
    FIG(o.figText, o.figAlt),
    '',
    '> 觉得有用的话，欢迎在评论区聊聊你最想深入的方向。',
  ].join('\n');
}

interface Demo {
  slug: string;
  title: string;
  summary: string;
  description: string;
  transcript: string;
  category: string;
  clip: string;
  durationSec: number;
  viewCount: number;
  likeCount: number;
  featured?: boolean;
  guest: { name: string; title: string; org: string };
}

const VIDEOS: Demo[] = [
  {
    slug: 'dialogue-karpathy-gpt-to-agent',
    title: '对话 Karpathy：从 GPT 到 Agent 的范式跃迁',
    summary: '从预训练到智能体，下一个十年的主线是什么。',
    description: [
      '> “范式的重心，正在从‘更大的模型’转向‘更好的使用’。”',
      '',
      '本期我们和 **Andrej K.** 聊了一个半小时，从预训练的 scaling 一路延伸到 agent 的工程落地。如果你只想看重点，下面是这期的结构与图解。',
      '',
      '## 关键看点',
      '',
      '- **Scaling 还没到头，但边际在变**：数据与算力仍有空间，真正的增量来自“如何使用模型”。',
      '- **Agent = 模型 × 工具 × 记忆 × 循环**：让模型在闭环里自我纠错，而不是一次性输出。',
      '- **评测要看端到端成功率**：榜单容易被污染，真实任务的通过率才是硬指标。',
      '',
      FIG('Pretrain -> RLHF -> Agent', '从预训练到 Agent 的范式演进'),
      '',
      '## 时间线',
      '',
      '| 时间 | 主题 |',
      '| --- | --- |',
      '| 00:00 | 开场 & 嘉宾介绍 |',
      '| 04:20 | Scaling law 的尽头在哪里 |',
      '| 18:40 | RLHF 之后是什么 |',
      '| 32:10 | Agent 的工程难点：记忆与工具 |',
      '| 51:00 | 给从业者的三条建议 |',
      '',
      '## 关于嘉宾',
      '',
      '![嘉宾近照](https://picsum.photos/seed/karpathy-guest/320/320)',
      '',
      'Andrej 长期参与大模型与自动驾驶 AI 的研究，本期分享了大量一线工程经验，也聊了他对未来三年的判断。更多细节见 [完整文字稿](https://example.com/transcript)。',
      '',
      '> 如果这期对你有帮助，欢迎在评论区聊聊你最想深入的方向。',
    ].join('\n'),
    transcript:
      '主持人：先聊聊你怎么看 scaling law 的尽头。嘉宾：数据和算力的边际还在，但范式重心正在从“更大的模型”转向“更好的使用”——也就是 agent 化：让模型调用工具、保持记忆、在循环里自我纠错。主持人：那评测呢？嘉宾：榜单只能反映一部分，真实任务的端到端成功率才是关键。',
    category: 'agent',
    clip: BBB720,
    durationSec: 10,
    viewCount: 18420,
    likeCount: 1203,
    featured: true,
    guest: { name: 'Andrej K.', title: '独立研究者 / 前自动驾驶 AI 负责人', org: 'AI Frontier' },
  },
  {
    slug: 'moe-scaling-trillion',
    title: 'MoE 实战：把万亿参数喂进推理',
    summary: '稀疏专家模型如何在不爆显存的前提下继续变大。',
    description: [
      '把模型做到**万亿参数**却不让单次推理爆显存——靠的是 **MoE（Mixture-of-Experts）**：每个 token 只激活少数专家。本期 **林 W.** 拆解了它的工程细节。',
      '',
      FIG('Token -> Router -> Top-2 Experts', 'MoE 稀疏路由示意'),
      '',
      '## 关键看点',
      '',
      '1. **稀疏激活**：总参数可以很大，单 token 计算量却受控。',
      '2. **路由不均衡**是头号敌人——用容量因子 + 辅助损失来平衡专家负载。',
      '3. **All-to-all 通信**在万卡集群上是真正的瓶颈，需要和并行策略协同设计。',
      '',
      '### 一段伪代码',
      '',
      '```python',
      'gate = softmax(x @ Wg)          # 每个 token 对各专家的打分',
      'idx  = topk(gate, k=2)          # 只取前 2 个专家',
      'y    = sum(gate[i] * Expert[i](x) for i in idx)',
      '```',
      '',
      '![专家负载分布](https://picsum.photos/seed/moe-load/960/380)',
      '',
      '> 想看完整的负载均衡实验？文字稿里有更详细的曲线。',
    ].join('\n'),
    transcript:
      '嘉宾：MoE 的核心是稀疏激活——每个 token 只走少数专家，所以总参数可以很大但单次计算可控。难点在路由不均衡和 all-to-all 通信。我们用容量因子 + 辅助损失来平衡专家负载。',
    category: 'infra',
    clip: JELLY,
    durationSec: 10,
    viewCount: 9931,
    likeCount: 642,
    featured: true,
    guest: { name: '林 W.', title: '基础模型负责人', org: 'DeepStack' },
  },
  {
    slug: 'embodied-ai-frontier',
    title: '具身智能前沿：当大模型有了身体',
    summary: 'VLA 模型、仿真到真机迁移，机器人的 GPT 时刻还有多远。',
    description: [
      '当大模型有了**身体**，会发生什么？本期 **赵 M.** 从 **VLA（视觉-语言-动作）** 模型聊到 sim-to-real 的鸿沟。',
      '',
      FIG('Vision + Language -> Action', 'VLA 模型输入输出'),
      '',
      '## 关键看点',
      '',
      '- 语言模型给了机器人**常识与规划**能力；',
      '- **真机数据极贵**，所以走“大规模仿真 + 少量真机微调”；',
      '- 长尾动作用**遥操作**补齐数据。',
      '',
      '## 现场画面',
      '',
      '![仿真到真机](https://picsum.photos/seed/embodied-sim/960/420)',
      '',
      '数据采集仍是具身智能最大的瓶颈——这期我们也聊了团队踩过的坑。完整 Demo 见 [项目主页](https://example.com/embodied)。',
    ].join('\n'),
    transcript:
      '嘉宾：语言模型给了机器人常识和规划能力，但真机数据极其昂贵。我们的做法是大规模仿真 + 少量真机微调，再用遥操作补齐长尾动作。',
    category: 'embodied',
    clip: SINTEL,
    durationSec: 10,
    viewCount: 14002,
    likeCount: 988,
    featured: true,
    guest: { name: '赵 M.', title: '机器人学习实验室主任', org: 'Embodied Lab' },
  },
  {
    slug: 'multimodal-unify-world',
    title: '多模态统一：一个模型看懂世界',
    summary: '图像、视频、音频、文本，如何塞进同一个 transformer。',
    description: mediumDesc({
      intro:
        '图像、视频、音频、文本，如何塞进**同一个 transformer**？本期聊原生多模态的几条技术路线，以及它相比“拼接式”管线的优势与代价。',
      points: [
        '**原生多模态**把不同模态 tokenize 到同一空间，端到端训练；',
        '避免了管线误差累积，但**数据对齐与训练成本**极高；',
        '统一表示让“跨模态检索 / 生成”变得自然。',
      ],
      figText: 'Image + Audio + Text -> Unified Tokens',
      figAlt: '统一多模态 token 空间',
    }),
    transcript:
      '嘉宾：原生多模态把不同模态 tokenize 到同一空间，端到端训练，避免了管线误差累积；代价是数据对齐和训练成本极高。',
    category: 'multimodal',
    clip: BBB360,
    durationSec: 10,
    viewCount: 7765,
    likeCount: 511,
    guest: { name: 'S. Patel', title: '多模态研究科学家', org: 'Vision&Language' },
  },
  {
    slug: 'inference-systems-vllm',
    title: '推理系统揭秘：如何榨干每一张 GPU',
    summary: 'PagedAttention、连续批处理、KV cache 的工程艺术。',
    description: mediumDesc({
      intro: '高吞吐 LLM 推理的秘密，全在**显存管理**。本期 **陈 J.** 拆解了三件套。',
      points: [
        '**PagedAttention**：像虚拟内存一样分页管理 KV cache；',
        '**连续批处理**：新请求随时插入正在跑的 batch；',
        '**投机解码**：用小模型抢跑、大模型校验。',
      ],
      figText: 'Continuous Batching + Paged KV Cache',
      figAlt: '高吞吐推理流水线',
    }),
    transcript:
      '嘉宾：吞吐的关键是显存管理。PagedAttention 像虚拟内存一样分页管理 KV cache，连续批处理让新请求随时插入正在跑的 batch，投机解码再用小模型抢跑。',
    category: 'infra',
    clip: FLOWER,
    durationSec: 30,
    viewCount: 12290,
    likeCount: 877,
    guest: { name: '陈 J.', title: '推理引擎架构师', org: 'FastServe' },
  },
  {
    slug: 'llm-eval-truth',
    title: '大模型评测的真相：榜单之外',
    summary: '为什么刷榜不等于好用，以及怎么做可信评测。',
    description: mediumDesc({
      intro: '为什么**刷榜 ≠ 好用**？本期聊评测里的数据污染、过拟合榜单，以及面向真实任务的端到端评测怎么搭。',
      points: [
        '很多榜单已被训练数据**污染**，分数虚高；',
        '更该看**保留集上的端到端任务成功率**；',
        '人类对比偏好（pairwise）往往比单点打分更可信。',
      ],
      figText: 'Leaderboard vs Real-Task Success',
      figAlt: '榜单分数 vs 真实任务成功率',
    }),
    transcript:
      '嘉宾：很多榜单已经被训练数据污染，分数虚高。我们更看重保留集上的端到端任务成功率，以及人类对比偏好。',
    category: 'llm',
    clip: JELLY,
    durationSec: 10,
    viewCount: 6604,
    likeCount: 433,
    guest: { name: '吴 L.', title: '评测平台负责人', org: 'EvalWorks' },
  },
  {
    slug: 'agent-memory-context-engineering',
    title: 'Agent 的记忆：上下文工程实战',
    summary: '检索、压缩、长期记忆，让 Agent 不再"金鱼脑"。',
    description: mediumDesc({
      intro: '让 Agent 不再“金鱼脑”，核心是**上下文工程**：在对的时刻把对的信息放进窗口。',
      points: [
        '**向量检索**召回相关历史；',
        '**摘要压缩**长对话，省 token；',
        '**结构化记忆**存关键事实，支撑长程任务。',
      ],
      figText: 'Retrieve + Compress + Long-term Memory',
      figAlt: '上下文工程三件套',
    }),
    transcript:
      '嘉宾：上下文工程的核心是“在对的时刻把对的信息放进窗口”。我们用向量检索召回、用摘要压缩历史、用结构化记忆存关键事实。',
    category: 'agent',
    clip: W3BBB,
    durationSec: 10,
    viewCount: 8841,
    likeCount: 690,
    guest: { name: 'M. Ortiz', title: 'Agent 框架作者', org: 'LoopAI' },
  },
  {
    slug: 'open-source-llm-year',
    title: '国产开源大模型的一年',
    summary: '从追赶到并跑，开源生态发生了什么。',
    description: mediumDesc({
      intro: '过去一年，开源大模型从**追赶**走向**并跑**。这期回顾能力曲线、许可证之争，以及对企业落地的影响。',
      points: [
        '开源把好模型门槛降到**一张消费级显卡**；',
        '企业可**私有化部署 + 微调自己的数据**——内网场景尤其受益；',
        '许可证与商用条款，是落地前必须看清的坑。',
      ],
      figText: 'Open-Source LLM Capability Over 12 Months',
      figAlt: '开源模型能力曲线',
    }),
    transcript:
      '嘉宾：开源把好模型的门槛降到了一张消费级显卡，企业可以私有化部署、微调自己的数据，这对内网场景尤其重要。',
    category: 'llm',
    clip: BBB360,
    durationSec: 10,
    viewCount: 10210,
    likeCount: 802,
    guest: { name: '黄 R.', title: '开源社区维护者', org: 'OpenModels' },
  },
  {
    slug: 'gpu-cluster-ops',
    title: '万卡集群运维：故障、调度与成本',
    summary: '训练一次大模型，背后是怎样的基础设施战争。',
    description: mediumDesc({
      intro: '训练一次大模型，背后是一场**基础设施战争**。本期 **周 H.** 聊万卡集群的故障、调度与成本。',
      points: [
        '万卡训练里**单卡故障是常态**；',
        '**checkpoint 快照 + 弹性调度**：掉卡后几分钟自动恢复；',
        '把有效算力利用率（MFU）拉到 **90%+** 的实战技巧。',
      ],
      figText: 'Checkpoint + Elastic Scheduling -> 90% MFU',
      figAlt: '弹性调度与容错',
    }),
    transcript:
      '嘉宾：万卡训练里，单卡故障是常态。我们做了 checkpoint 快照 + 弹性调度，让任务在掉卡后几分钟内自动恢复，把有效算力利用率拉到 90% 以上。',
    category: 'infra',
    clip: SINTEL,
    durationSec: 10,
    viewCount: 5527,
    likeCount: 371,
    guest: { name: '周 H.', title: '算力平台 SRE 负责人', org: 'ClusterOps' },
  },
];

interface CommentSeed {
  body: string;
  likes?: number;
  replies?: { body: string; likes?: number }[];
}

const COMMENTS: Record<string, CommentSeed[]> = {
  'dialogue-karpathy-gpt-to-agent': [
    {
      body: '这期信息量爆炸，agent 化那段直接醍醐灌顶 🤯',
      likes: 42,
      replies: [
        { body: '+1，端到端成功率比刷榜更有意义这点太对了', likes: 8 },
        { body: '蹲一个完整文字稿，想反复看', likes: 3 },
      ],
    },
    {
      body: '请问嘉宾提到的“记忆压缩”有推荐的论文吗？',
      likes: 12,
      replies: [{ body: '简介里贴了链接，翻到“关于嘉宾”那段就有～', likes: 5 }],
    },
    { body: '听完直接去重构了我们的 agent 循环，效果立竿见影。', likes: 19 },
    { body: '主持人问得很专业，节奏很舒服，不啰嗦。', likes: 7 },
    {
      body: '希望能出一期专门讲 RLHF 之后的路线 🙏',
      likes: 15,
      replies: [{ body: '同求！最好能带点代码', likes: 2 }],
    },
    { body: '画质音质都在线，这个系列必须追。', likes: 4 },
  ],
  'moe-scaling-trillion': [
    {
      body: '路由不均衡那段太真实了，我们线上也是被 all-to-all 卡住的。',
      likes: 28,
      replies: [{ body: '容量因子调多少比较合适？求经验值', likes: 6 }],
    },
    { body: '伪代码很清晰，topk=2 是目前的主流选择吗？', likes: 11 },
    { body: '万亿参数听着吓人，但稀疏激活一解释就懂了，赞。', likes: 17 },
    {
      body: '请问负载均衡的辅助损失权重一般取多大？',
      likes: 9,
      replies: [{ body: '一般 1e-2 量级，按专家利用率调', likes: 4 }],
    },
    { body: '通信优化能再单独出一期吗，想看 EP/TP 怎么切。', likes: 13 },
  ],
  'embodied-ai-frontier': [
    {
      body: 'sim-to-real 永远的痛……遥操作补数据这招很实在。',
      likes: 33,
      replies: [
        { body: '遥操作的成本其实也不低吧？', likes: 5 },
        { body: '比真机随机探索便宜多了，而且安全', likes: 7 },
      ],
    },
    { body: 'VLA 这条路线感觉是对的，期待更多真机 demo。', likes: 21 },
    { body: '机器人的 GPT 时刻，我赌三年内 👀', likes: 14 },
    { body: '数据采集是瓶颈这点深有体会，跪求开源数据集。', likes: 18 },
    { body: '实验室画面好酷，想去参观（不是', likes: 6 },
  ],
  'multimodal-unify-world': [
    { body: '原生多模态 vs 拼接式，这个对比讲得很清楚。', likes: 16 },
    {
      body: '训练成本那块有具体数字吗？',
      likes: 8,
      replies: [{ body: '据说对齐数据的清洗占了大头', likes: 3 }],
    },
    { body: '统一 token 空间确实优雅，但工程上太难了。', likes: 12 },
  ],
  'inference-systems-vllm': [
    {
      body: 'PagedAttention 那个虚拟内存的类比绝了，秒懂。',
      likes: 24,
      replies: [{ body: '同感，这个比喻应该进教科书', likes: 6 }],
    },
    { body: '投机解码上线后我们 P99 直接降了一半。', likes: 19 },
    { body: '连续批处理的调度策略能展开讲讲吗？', likes: 9 },
    { body: '榨干 GPU 这个标题太贴切了哈哈。', likes: 5 },
  ],
  'llm-eval-truth': [
    { body: '数据污染这个问题被严重低估了，支持！', likes: 22 },
    {
      body: '请问你们的保留集是怎么构造的，怕又被污染。',
      likes: 10,
      replies: [{ body: '持续更新 + 不公开题目，是个长期活', likes: 5 }],
    },
    { body: '人类 pairwise 偏好确实更靠谱，但贵。', likes: 8 },
  ],
  'agent-memory-context-engineering': [
    {
      body: '“金鱼脑”这个比喻太形象了 🐟',
      likes: 26,
      replies: [{ body: '哈哈哈 我的 agent 就是金鱼', likes: 9 }],
    },
    { body: '结构化记忆这块有没有开源实现推荐？', likes: 13 },
    { body: '摘要压缩省 token 实测有效，强烈推荐。', likes: 11 },
  ],
  'open-source-llm-year': [
    { body: '内网私有化这块说到心坎里了，企业刚需。', likes: 20 },
    { body: '许可证的坑真的多，签之前一定要看清楚。', likes: 12, replies: [{ body: '+1 血泪教训', likes: 4 }] },
    { body: '一张消费级显卡就能跑，这一年进步太快了。', likes: 15 },
  ],
  'gpu-cluster-ops': [
    { body: '90% MFU 是真的强，我们还在 60% 挣扎……', likes: 17, replies: [{ body: '求弹性调度的具体方案 🙏', likes: 6 }] },
    { body: '单卡故障是常态这句话，运维狗含泪点赞。', likes: 14 },
    { body: 'checkpoint 快照频率一般怎么定？', likes: 8 },
  ],
};

async function main() {
  const admin =
    (await prisma.user.findFirst({ where: { isAdmin: true } })) ?? (await prisma.user.findFirst());
  if (!admin) {
    throw new Error('No user found to own demo videos — run pnpm db:seed first.');
  }
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' }, take: 20 });
  let ui = 0;
  const nextUser = () => users[ui++ % users.length] ?? admin;

  // Categories
  const catId: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const row = await prisma.videoCategory.upsert({
      where: { slug: c.slug },
      create: c,
      update: { name: c.name, sortOrder: c.sortOrder },
    });
    catId[c.slug] = row.id;
  }

  console.log(`Downloading clips + posters into ${STORAGE_VIDEOS} …`);
  const now = Date.now();
  let i = 0;
  for (const v of VIDEOS) {
    const publishedAt = new Date(now - i * 36 * 3600 * 1000); // ~1.5 days apart

    // Download the clip + poster into local storage (cached on re-run).
    const videoKey = await fetchToLocal(v.clip, `source/demo-${v.slug}.mp4`, 50_000);
    const posterKey = await fetchToLocal(POSTER_SRC(v.slug), `poster/demo-${v.slug}.jpg`, 2_000);
    const videoUrl = `/api/videos/file/${videoKey}`;
    const posterUrl = `/api/videos/file/${posterKey}`;
    console.log(`  ✓ ${v.slug}`);

    const common = {
      title: v.title,
      summary: v.summary,
      descriptionMd: v.description,
      transcriptText: v.transcript,
      posterUrl,
      posterKey,
      videoUrl,
      videoKey,
      durationSec: v.durationSec,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      featured: Boolean(v.featured),
      featuredAt: v.featured ? publishedAt : null,
      categoryId: catId[v.category],
      intervieweeName: v.guest.name,
      intervieweeTitle: v.guest.title,
      intervieweeOrg: v.guest.org,
      status: 'published' as const,
      visibility: 'public' as const,
      publishedAt,
    };
    await prisma.video.upsert({
      where: { slug: v.slug },
      update: common,
      create: {
        ...common,
        slug: v.slug,
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        sourceType: 'admin_curated',
        language: 'zh',
        uploaderId: admin.id,
      },
    });
    i++;
  }

  // Comments — reset + reseed per demo video (idempotent, richer set).
  let commentTotal = 0;
  for (const [slug, comments] of Object.entries(COMMENTS)) {
    const video = await prisma.video.findUnique({ where: { slug }, select: { id: true } });
    if (!video) continue;
    await prisma.videoComment.deleteMany({ where: { videoId: video.id } });

    let count = 0;
    for (const c of comments) {
      const top = await prisma.videoComment.create({
        data: { videoId: video.id, authorId: nextUser().id, bodyMd: c.body, likeCount: c.likes ?? 0 },
      });
      count++;
      if (c.replies?.length) {
        for (const r of c.replies) {
          await prisma.videoComment.create({
            data: {
              videoId: video.id,
              authorId: nextUser().id,
              parentId: top.id,
              bodyMd: r.body,
              likeCount: r.likes ?? 0,
            },
          });
          count++;
        }
        await prisma.videoComment.update({
          where: { id: top.id },
          data: { replyCount: c.replies.length },
        });
      }
    }
    await prisma.video.update({ where: { id: video.id }, data: { commentCount: count } });
    commentTotal += count;
  }

  const total = await prisma.video.count();
  console.log(
    `✅ Seeded ${VIDEOS.length} LOCAL demo videos (${CATEGORIES.length} categories) + ${commentTotal} comments. Total videos in DB: ${total}.`,
  );
  console.log(`   Clips served from ${STORAGE_VIDEOS} via /api/videos/file. Owner: ${admin.email}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
