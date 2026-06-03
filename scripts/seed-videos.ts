// Demo seeder for the video board. Idempotent (upsert by slug). Uses public
// sample MP4s (Google test bucket — support HTTP range so the player seeks) and
// photo posters (picsum). Run: pnpm exec tsx scripts/seed-videos.ts
import { PrismaClient } from '@prisma/client';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

const prisma = new PrismaClient();

const MP4 = (f: string) => `https://storage.googleapis.com/gtv-videos-bucket/sample/${f}.mp4`;
const POSTER = (seed: string) => `https://picsum.photos/seed/${seed}/800/450`;

const CATEGORIES = [
  { slug: 'llm', name: '大模型', sortOrder: 1 },
  { slug: 'agent', name: 'Agent', sortOrder: 2 },
  { slug: 'infra', name: '算力 / 推理系统', sortOrder: 3 },
  { slug: 'embodied', name: '具身智能', sortOrder: 4 },
  { slug: 'multimodal', name: '多模态', sortOrder: 5 },
];

interface Demo {
  slug: string;
  title: string;
  summary: string;
  description: string;
  transcript: string;
  category: string;
  file: string;
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
    description: '我们和一位深度参与大模型时代的研究者聊了聊：预训练的 scaling 还能走多远、RLHF 之后是什么、以及为什么"Agent"会是接下来最重要的产品形态。',
    transcript: '主持人：先聊聊你怎么看 scaling law 的尽头。嘉宾：数据和算力的边际还在，但范式重心正在从"更大的模型"转向"更好的使用"——也就是 agent 化：让模型调用工具、保持记忆、在循环里自我纠错。主持人：那评测呢？嘉宾：榜单只能反映一部分，真实任务的端到端成功率才是关键。',
    category: 'agent',
    file: 'BigBuckBunny',
    durationSec: 2730,
    viewCount: 18420,
    likeCount: 1203,
    featured: true,
    guest: { name: 'Andrej K.', title: '独立研究者 / 前自动驾驶 AI 负责人', org: 'AI Frontier' },
  },
  {
    slug: 'moe-scaling-trillion',
    title: 'MoE 实战：把万亿参数喂进推理',
    summary: '稀疏专家模型如何在不爆显存的前提下继续变大。',
    description: '深入 Mixture-of-Experts 的工程细节：专家路由、负载均衡、通信瓶颈，以及在万卡集群上训练与部署万亿级模型的取舍。',
    transcript: '嘉宾：MoE 的核心是稀疏激活——每个 token 只走少数专家，所以总参数可以很大但单次计算可控。难点在路由不均衡和 all-to-all 通信。我们用容量因子 + 辅助损失来平衡专家负载。',
    category: 'infra',
    file: 'ElephantsDream',
    durationSec: 3120,
    viewCount: 9931,
    likeCount: 642,
    featured: true,
    guest: { name: '林 W.', title: '基础模型负责人', org: 'DeepStack' },
  },
  {
    slug: 'embodied-ai-frontier',
    title: '具身智能前沿：当大模型有了身体',
    summary: 'VLA 模型、仿真到真机迁移，机器人的 GPT 时刻还有多远。',
    description: '从视觉-语言-动作（VLA）模型谈到 sim-to-real 的鸿沟，以及为什么数据采集仍是具身智能最大的瓶颈。',
    transcript: '嘉宾：语言模型给了机器人常识和规划能力，但真机数据极其昂贵。我们的做法是大规模仿真 + 少量真机微调，再用遥操作补齐长尾动作。',
    category: 'embodied',
    file: 'Sintel',
    durationSec: 3450,
    viewCount: 14002,
    likeCount: 988,
    featured: true,
    guest: { name: '赵 M.', title: '机器人学习实验室主任', org: 'Embodied Lab' },
  },
  {
    slug: 'multimodal-unify-world',
    title: '多模态统一：一个模型看懂世界',
    summary: '图像、视频、音频、文本，如何塞进同一个 transformer。',
    description: '统一多模态表示的几条技术路线，以及原生多模态相比"拼接式"管线的优势与代价。',
    transcript: '嘉宾：原生多模态把不同模态 tokenize 到同一空间，端到端训练，避免了管线误差累积；代价是数据对齐和训练成本极高。',
    category: 'multimodal',
    file: 'TearsOfSteel',
    durationSec: 2280,
    viewCount: 7765,
    likeCount: 511,
    guest: { name: 'S. Patel', title: '多模态研究科学家', org: 'Vision&Language' },
  },
  {
    slug: 'inference-systems-vllm',
    title: '推理系统揭秘：如何榨干每一张 GPU',
    summary: 'PagedAttention、连续批处理、KV cache 的工程艺术。',
    description: '高吞吐 LLM 推理背后的系统设计：分页注意力、连续批处理、投机解码，以及它们如何把 GPU 利用率拉满。',
    transcript: '嘉宾：吞吐的关键是显存管理。PagedAttention 像虚拟内存一样分页管理 KV cache，连续批处理让新请求随时插入正在跑的 batch，投机解码再用小模型抢跑。',
    category: 'infra',
    file: 'ForBiggerBlazes',
    durationSec: 1980,
    viewCount: 12290,
    likeCount: 877,
    guest: { name: '陈 J.', title: '推理引擎架构师', org: 'FastServe' },
  },
  {
    slug: 'llm-eval-truth',
    title: '大模型评测的真相：榜单之外',
    summary: '为什么刷榜不等于好用，以及怎么做可信评测。',
    description: '聊聊评测的数据污染、过拟合榜单、以及面向真实任务的端到端评测怎么搭。',
    transcript: '嘉宾：很多榜单已经被训练数据污染，分数虚高。我们更看重保留集上的端到端任务成功率，以及人类对比偏好。',
    category: 'llm',
    file: 'ForBiggerEscapes',
    durationSec: 1620,
    viewCount: 6604,
    likeCount: 433,
    guest: { name: '吴 L.', title: '评测平台负责人', org: 'EvalWorks' },
  },
  {
    slug: 'agent-memory-context-engineering',
    title: 'Agent 的记忆：上下文工程实战',
    summary: '检索、压缩、长期记忆，让 Agent 不再"金鱼脑"。',
    description: '从短期上下文窗口到长期记忆库，介绍 RAG、记忆压缩和工具调用如何协同支撑长程任务。',
    transcript: '嘉宾：上下文工程的核心是"在对的时刻把对的信息放进窗口"。我们用向量检索召回、用摘要压缩历史、用结构化记忆存关键事实。',
    category: 'agent',
    file: 'ForBiggerFun',
    durationSec: 2100,
    viewCount: 8841,
    likeCount: 690,
    guest: { name: 'M. Ortiz', title: 'Agent 框架作者', org: 'LoopAI' },
  },
  {
    slug: 'open-source-llm-year',
    title: '国产开源大模型的一年',
    summary: '从追赶到并跑，开源生态发生了什么。',
    description: '回顾过去一年开源大模型的进展：能力曲线、许可证之争、以及对企业落地的影响。',
    transcript: '嘉宾：开源把好模型的门槛降到了一张消费级显卡，企业可以私有化部署、微调自己的数据，这对内网场景尤其重要。',
    category: 'llm',
    file: 'ForBiggerJoyrides',
    durationSec: 1740,
    viewCount: 10210,
    likeCount: 802,
    guest: { name: '黄 R.', title: '开源社区维护者', org: 'OpenModels' },
  },
  {
    slug: 'gpu-cluster-ops',
    title: '万卡集群运维：故障、调度与成本',
    summary: '训练一次大模型，背后是怎样的基础设施战争。',
    description: '从网络拓扑到故障自愈，聊聊万卡级训练集群的调度、容错和成本优化。',
    transcript: '嘉宾：万卡训练里，单卡故障是常态。我们做了 checkpoint 快照 + 弹性调度，让任务在掉卡后几分钟内自动恢复，把有效算力利用率拉到 90% 以上。',
    category: 'infra',
    file: 'ForBiggerMeltdowns',
    durationSec: 2940,
    viewCount: 5527,
    likeCount: 371,
    guest: { name: '周 H.', title: '算力平台 SRE 负责人', org: 'ClusterOps' },
  },
];

async function main() {
  const admin =
    (await prisma.user.findFirst({ where: { isAdmin: true } })) ??
    (await prisma.user.findFirst());
  if (!admin) {
    throw new Error('No user found to own demo videos — run pnpm db:seed first.');
  }
  const secondUser = await prisma.user.findFirst({ where: { id: { not: admin.id } } });

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

  // Videos — publishedAt staggered so the feed has a sensible order.
  const now = Date.now();
  let i = 0;
  for (const v of VIDEOS) {
    const publishedAt = new Date(now - i * 36 * 3600 * 1000); // ~1.5 days apart
    await prisma.video.upsert({
      where: { slug: v.slug },
      update: {
        title: v.title,
        summary: v.summary,
        descriptionMd: v.description,
        transcriptText: v.transcript,
        posterUrl: POSTER(v.slug),
        videoUrl: MP4(v.file),
        durationSec: v.durationSec,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        featured: Boolean(v.featured),
        featuredAt: v.featured ? publishedAt : null,
        categoryId: catId[v.category],
        intervieweeName: v.guest.name,
        intervieweeTitle: v.guest.title,
        intervieweeOrg: v.guest.org,
        status: 'published',
        visibility: 'public',
        publishedAt,
      },
      create: {
        slug: v.slug,
        title: v.title,
        summary: v.summary,
        descriptionMd: v.description,
        transcriptText: v.transcript,
        posterUrl: POSTER(v.slug),
        videoUrl: MP4(v.file),
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationSec: v.durationSec,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        featured: Boolean(v.featured),
        featuredAt: v.featured ? publishedAt : null,
        sourceType: 'admin_curated',
        status: 'published',
        visibility: 'public',
        language: 'zh',
        publishedAt,
        uploaderId: admin.id,
        categoryId: catId[v.category],
        intervieweeName: v.guest.name,
        intervieweeTitle: v.guest.title,
        intervieweeOrg: v.guest.org,
      },
    });
    i++;
  }

  // A few comments on the first featured video so the comment UI isn't empty.
  const first = await prisma.video.findUnique({ where: { slug: VIDEOS[0].slug } });
  if (first) {
    const existing = await prisma.videoComment.count({ where: { videoId: first.id } });
    if (existing === 0) {
      const top = await prisma.videoComment.create({
        data: { videoId: first.id, authorId: admin.id, bodyMd: '这期信息量很大，关于 agent 化那段说得太对了。', likeCount: 4 },
      });
      await prisma.video.update({ where: { id: first.id }, data: { commentCount: { increment: 1 } } });
      if (secondUser) {
        await prisma.videoComment.create({
          data: { videoId: first.id, authorId: secondUser.id, parentId: top.id, bodyMd: '+1，尤其是端到端成功率比榜单更重要这点。' },
        });
        await prisma.videoComment.update({ where: { id: top.id }, data: { replyCount: { increment: 1 } } });
        await prisma.video.update({ where: { id: first.id }, data: { commentCount: { increment: 1 } } });
      }
    }
  }

  const total = await prisma.video.count();
  console.log(`✅ Seeded ${VIDEOS.length} demo videos (${CATEGORIES.length} categories). Total videos in DB: ${total}.`);
  console.log(`   Owner: ${admin.email} (${admin.handle}). Visit /videos to see the home feed.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
