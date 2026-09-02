// ═══════════════════════════════════════════════════════════════════════════
// 演示内容 —— 跟着 git 走、一条命令装上、一条命令拆干净
// ═══════════════════════════════════════════════════════════════════════════
//
//   pnpm demo:seed              # 装上（幂等：重复跑不会翻倍）
//   pnpm demo:unseed            # 拆掉（连它拷进 storage 的文件一起）
//   pnpm demo:unseed --dry-run  # 只报告会删什么，不动数据库、不动磁盘
//
// WHY THIS EXISTS
// 迁移的时候数据库带不过去，但演示要有东西可看。所以演示内容不是「数据库里的
// 种子数据」，而是仓库里的一段代码 + `scripts/demo/assets/` 里几百 KB 的附件：
// 目标机器 `git pull` 之后跑一条命令就有，演示完再跑一条命令就没有。
//
// ─── 删除边界（这一段就是安全性的全部依据，改代码前先读它）────────────────
//
// 本脚本只会删三组行，三组都由下面的常量点名，不靠前缀猜、不靠时间猜：
//
//   (1) `DEMO_ZONE_SLUGS` 里那两个 slug 的 Zone 行，以及它们级联带走的一切
//       —— 帖子、附件、评论、点赞、收藏、浏览、栏目、成员、版块角色、Wiki。
//       换句话说：**「在这两个演示版块里」就是「属于演示」**。
//   (2) `DEMO_EVENT_IDS` 里那些 id 的 Event 行，以及级联带走的讲师与参加记录。
//       `Event` 没有 slug，所以演示活动**自带写死的 id**（`demo-evt-…`）——
//       id 就是边界，跟版块的 slug 是一回事。unseed 会**显式**删这些行，而不是
//       靠「删演示账号 → 级联带走它发的活动」：级联当然也能删干净，但那样边界
//       就藏在外键里，读不到；这里要的是文件开头一眼能读到的边界。
//   (3) `DEMO_PEOPLE` 里那几个 email 的 User 行（演示同事账号），以及它们级联
//       带走的通知等行。
//
// 磁盘上只删这三组行自己引用的 key，而且删之前会再查一遍「有没有别的行还在引用
// 它」—— 有就跳过。除此之外一个字节都不碰。两个存储根：
//   · zone-media：版块封面/图标、帖子封面、附件的 key / poster / preview；
//   · uploads/images：活动封面与讲师头像（`Event.coverUrl` 只收
//     `/api/uploads/…`，所以活动的图片走的是通用图片存储，不是 zone-media）。
//
// 反过来说，这些**永远不会被删**：发起人（真人账号，只是被设成版块主版主）、
// 任何别的版块、别人的帖子、别人的活动、别人的文件。
//
// 需要知情的两个副作用：
//   · 如果有真人跑去演示版块里发了帖 / 评论 / 加入成员，unseed 删版块时会把这些
//     一起带走。演示版块就是演示用的，别在里面干真活。
//   · 发起人（真人账号）会被加进三个演示活动的「我要参加」名单，好让演示里的
//     「我参加的」不是空的。这是 EventAttendee 行，跟着活动一起被删，删完
//     计数回到基线；不想要就把 `OWNER` 从 `DEMO_EVENTS` 的 attendees 里去掉。
//
// ─── 幂等怎么做到的 ─────────────────────────────────────────────────────────
//
// `seed` 一上来先跑一遍 `unseed`（静默），再从零建一次。所以「重复跑不会翻倍」
// 和「改了文案重跑就是最新的」是同一个机制，不需要一堆 upsert 去猜哪些字段该
// 覆盖。代价是帖子 id 每次都会变（演示内容没人收藏，无所谓）；演示同事账号则
// 按 email upsert，id 保持稳定。
//
// ─── 写入尽量走 app 自己的库 ────────────────────────────────────────────────
//
// 版块 / 栏目 / 成员 / 帖子 / Wiki 全部经过 lib/zones/* 的正规入口，这样演示内容
// 不会跟真实契约漂移（附件 key 校验、栏目计数、发布计数、@人 通知都是真的在跑）。
// 少数几处直接写行的地方，每一处都在注释里写了为什么没有库函数可用。

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
// 只取类型 —— 编译期就擦掉，不会在 loadEnv 之前把 @/lib/env 拖起来。
import type { EventCityValue, EventTimezoneValue } from '@/lib/events/types';

loadEnv();
loadEnv({ path: '.env.local', override: true });

// ─── 演示对象：两个版块 + 十五个活动 + 五个演示同事 ────────────────────────

const ZONE_INFERENCE = 'demo-inference-accel';
const ZONE_GRAPHICS = 'demo-graphics-render';
/** 删除边界 (1)。只有这两个 slug 的版块会被 unseed 碰。 */
const DEMO_ZONE_SLUGS = [ZONE_INFERENCE, ZONE_GRAPHICS] as const;

/**
 * 删除边界 (2)。`Event` 没有 slug，`id` 又只是普通 `String @id`，所以演示活动
 * 自带写死的 id —— 这一串就是边界本身，unseed 只按它删 Event 行。
 *
 * 文件末尾的内容表 `DEMO_EVENTS` 必须**恰好**覆盖这一串：seed 一开始会断言，
 * 改了一边忘了改另一边会立刻报错，不会出现「加了个活动，unseed 删不掉」。
 */
const DEMO_EVENT_IDS = [
  'demo-evt-past-summit',
  'demo-evt-past-memory-talk',
  'demo-evt-past-data-seminar',
  'demo-evt-past-toolchain-cancelled',
  'demo-evt-past-render-workshop',
  'demo-evt-past-paper-lunch',
  'demo-evt-live-agent-hack',
  'demo-evt-today-eval-talk',
  'demo-evt-week-algo-seminar',
  'demo-evt-embodied-talk',
  'demo-evt-open-day',
  'demo-evt-tech-week',
  'demo-evt-scheduler-seminar',
  'demo-evt-render-review',
  'demo-evt-graphics-forum',
] as const;

/** lib/org.ts 的 INSTITUTES[0]；Zone.lab 存 研究所，Zone.department 存 实验室。 */
const INSTITUTE = '温哥华研究所';
const LAB_CDAA = 'Computing Data Application Acceleration Laboratory';
const LAB_GRAPHICS = 'Graphics Technology Laboratory';

interface DemoPerson {
  handle: string;
  email: string;
  displayName: string;
  /** User.department = 部门；User.lab = 研究所（DeptTag 渲染成「部门 · 研究所」）。 */
  department: string;
  bio: string;
}

/** 删除边界 (2)。unseed 按 email 精确删这几行。 */
const DEMO_PEOPLE: readonly DemoPerson[] = [
  {
    handle: 'demo-lifang',
    email: 'demo-lifang@demo.invalid',
    displayName: '李芳',
    department: '推理加速团队',
    bio: '演示账号：推理内核与量化。这个账号只用于社区功能演示，可随时删除。',
  },
  {
    handle: 'demo-chentuo',
    email: 'demo-chentuo@demo.invalid',
    displayName: '陈拓',
    department: '推理加速团队',
    bio: '演示账号：调度与批处理。这个账号只用于社区功能演示，可随时删除。',
  },
  {
    handle: 'demo-zhouke',
    email: 'demo-zhouke@demo.invalid',
    displayName: '周珂',
    department: '图形渲染团队',
    bio: '演示账号：移动端渲染管线。这个账号只用于社区功能演示，可随时删除。',
  },
  {
    handle: 'demo-huangjing',
    email: 'demo-huangjing@demo.invalid',
    displayName: '黄婧',
    department: '系统评测团队',
    bio: '演示账号：评测方法与回归基线。这个账号只用于社区功能演示，可随时删除。',
  },
  {
    handle: 'demo-wangsen',
    email: 'demo-wangsen@demo.invalid',
    displayName: '王森',
    department: '编译与工具链团队',
    bio: '演示账号：编译与工具链。这个账号只用于社区功能演示，可随时删除。',
  },
];

const DEMO_EMAILS = DEMO_PEOPLE.map((p) => p.email);

// ─── 资产 ───────────────────────────────────────────────────────────────────
//
// `LOCAL_STORAGE_DIR` 不在版本库里，所以附件的字节存在 `scripts/demo/assets/`，
// 由 seed 拷进 zone-media 存储并建 ZonePostAttachment 行。要改这些文件，编辑
// `scripts/demo/make-assets.py` 后重新生成。

const ASSET_DIR = path.resolve(process.cwd(), 'scripts', 'demo', 'assets');

/** 附件的 content type 由扩展名决定（本地文件没有浏览器给的 MIME）。 */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown',
};

// ─── 小工具 ─────────────────────────────────────────────────────────────────

const FENCE = '```'; // 模板字符串里写不了裸反引号围栏

const DAY = 24 * 60 * 60 * 1000;
/** 相对「现在」的天数 → 具体时刻。演示内容全是当下时间会一眼看出是刷进去的。 */
function daysAgo(days: number, hour = 10, minute = 0): Date {
  const d = new Date(Date.now() - days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function log(msg: string): void {
  console.log(msg);
}

// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantUnseed = argv.includes('--unseed');
  const dryRun = argv.includes('--dry-run');

  // env 先装好再 import —— @/lib/env 在 import 期就校验整个 process.env。
  const { prisma } = await import('@/lib/db');

  try {
    if (wantUnseed) {
      await unseed({ dryRun, verbose: true });
    } else {
      if (dryRun) {
        log('--dry-run 只对 pnpm demo:unseed 有意义；seed 没有「假装建一遍」这回事。');
        process.exitCode = 2;
        return;
      }
      await seed();
    }
  } finally {
    await prisma.$disconnect();
  }
}

// ─── unseed ─────────────────────────────────────────────────────────────────

interface RemovalReport {
  zones: string[];
  posts: number;
  attachments: number;
  comments: number;
  columns: number;
  wikiPages: number;
  members: number;
  events: number;
  speakers: number;
  attendees: number;
  users: string[];
  /** zone-media 存储根里要删 / 要留的 key。 */
  filesDeleted: string[];
  filesKept: string[];
  /** uploads 存储根里要删 / 要留的 key（活动封面与讲师头像）。 */
  uploadsDeleted: string[];
  uploadsKept: string[];
}

async function unseed(opts: { dryRun: boolean; verbose: boolean }): Promise<RemovalReport> {
  const { prisma } = await import('@/lib/db');
  const { zoneMediaAbsPath, zoneMediaKeyFromUrl, deleteZoneMediaFile } = await import('@/lib/zones/storage');

  const zones = await prisma.zone.findMany({
    where: { slug: { in: [...DEMO_ZONE_SLUGS] } },
    select: { id: true, slug: true, name: true, coverKey: true, iconKey: true },
  });
  const zoneIds = zones.map((z) => z.id);

  const posts = zoneIds.length
    ? await prisma.zonePost.findMany({ where: { zoneId: { in: zoneIds } }, select: { id: true, coverKey: true } })
    : [];
  const postIds = posts.map((p) => p.id);
  const attachments = postIds.length
    ? await prisma.zonePostAttachment.findMany({
        where: { postId: { in: postIds } },
        select: { key: true, previewKey: true, previewUrl: true, posterUrl: true },
      })
    : [];

  const [comments, columns, wikiPages, members] = await Promise.all([
    postIds.length ? prisma.zonePostComment.count({ where: { postId: { in: postIds } } }) : 0,
    zoneIds.length ? prisma.zoneColumn.count({ where: { zoneId: { in: zoneIds } } }) : 0,
    zoneIds.length ? prisma.zoneWikiPage.count({ where: { zoneId: { in: zoneIds } } }) : 0,
    zoneIds.length ? prisma.zoneMember.count({ where: { zoneId: { in: zoneIds } } }) : 0,
  ]);

  // 候选文件 = 上面这些行自己引用的 key。posterUrl / previewUrl 存的是 URL，
  // 用 zoneMediaKeyFromUrl 反解回 key（外来 URL 会返回 null，自然被过滤掉）。
  const candidateKeys = new Set<string>();
  for (const z of zones) {
    if (z.coverKey) candidateKeys.add(z.coverKey);
    if (z.iconKey) candidateKeys.add(z.iconKey);
  }
  for (const p of posts) if (p.coverKey) candidateKeys.add(p.coverKey);
  for (const a of attachments) {
    candidateKeys.add(a.key);
    if (a.previewKey) candidateKeys.add(a.previewKey);
    for (const url of [a.previewUrl, a.posterUrl]) {
      const k = zoneMediaKeyFromUrl(url);
      if (k) candidateKeys.add(k);
    }
  }

  // 删之前先确认没有「演示之外」的行还在引用同一个 key。附件的 key 是 @unique，
  // 理论上不会重；封面 / 图标没有唯一约束，所以这一步是真的在兜底。
  const keys = [...candidateKeys];
  const referencedElsewhere = new Set<string>();
  if (keys.length > 0 && zoneIds.length > 0) {
    const [otherZones, otherPosts, otherAttachments] = await Promise.all([
      prisma.zone.findMany({
        where: { id: { notIn: zoneIds }, OR: [{ coverKey: { in: keys } }, { iconKey: { in: keys } }] },
        select: { coverKey: true, iconKey: true },
      }),
      prisma.zonePost.findMany({
        where: { zoneId: { notIn: zoneIds }, coverKey: { in: keys } },
        select: { coverKey: true },
      }),
      prisma.zonePostAttachment.findMany({
        where: {
          post: { zoneId: { notIn: zoneIds } },
          OR: [{ key: { in: keys } }, { previewKey: { in: keys } }],
        },
        select: { key: true, previewKey: true },
      }),
    ]);
    for (const r of otherZones) {
      if (r.coverKey) referencedElsewhere.add(r.coverKey);
      if (r.iconKey) referencedElsewhere.add(r.iconKey);
    }
    for (const r of otherPosts) if (r.coverKey) referencedElsewhere.add(r.coverKey);
    for (const r of otherAttachments) {
      referencedElsewhere.add(r.key);
      if (r.previewKey) referencedElsewhere.add(r.previewKey);
    }
  }

  // ── 删除边界 (2)：点名的那些活动 ──────────────────────────────────────────
  //
  // 显式查、显式删。这些活动的作者多半是演示账号，删账号时级联也能带走它们，
  // 但那样边界就藏在外键里了 —— 这里要的是「文件开头读得到」的边界。
  const events = await prisma.event.findMany({
    where: { id: { in: [...DEMO_EVENT_IDS] } },
    select: { id: true, coverUrl: true, speakers: { select: { avatarUrl: true } } },
  });
  const eventIds = events.map((e) => e.id);
  const [speakerCount, attendeeCount] = await Promise.all([
    eventIds.length ? prisma.eventSpeaker.count({ where: { eventId: { in: eventIds } } }) : 0,
    eventIds.length ? prisma.eventAttendee.count({ where: { eventId: { in: eventIds } } }) : 0,
  ]);

  // 活动的图片在另一个存储根（uploads/images），单独算一遍候选与「别处还在用」。
  const uploadUrls = new Set<string>();
  for (const e of events) {
    if (e.coverUrl) uploadUrls.add(e.coverUrl);
    for (const s of e.speakers) if (s.avatarUrl) uploadUrls.add(s.avatarUrl);
  }
  const urls = [...uploadUrls];
  const uploadUsedElsewhere = new Set<string>();
  if (urls.length > 0) {
    const [otherEvents, otherSpeakers] = await Promise.all([
      prisma.event.findMany({
        where: { id: { notIn: eventIds }, coverUrl: { in: urls } },
        select: { coverUrl: true },
      }),
      prisma.eventSpeaker.findMany({
        where: { eventId: { notIn: eventIds }, avatarUrl: { in: urls } },
        select: { avatarUrl: true },
      }),
    ]);
    for (const r of otherEvents) if (r.coverUrl) uploadUsedElsewhere.add(r.coverUrl);
    for (const r of otherSpeakers) uploadUsedElsewhere.add(r.avatarUrl);
  }
  // key 反解失败（外链头像 / 脏数据）的直接不进候选集 —— 不是我们放进去的文件。
  const uploadKeys = (list: string[]): string[] =>
    list.map(uploadKeyFromUrl).filter((k): k is string => k !== null);

  const existingUsers = await prisma.user.findMany({
    where: { email: { in: DEMO_EMAILS } },
    select: { id: true, email: true, handle: true },
  });

  const report: RemovalReport = {
    zones: zones.map((z) => `${z.name} (/zones/${z.slug})`),
    posts: posts.length,
    attachments: attachments.length,
    comments,
    columns,
    wikiPages,
    members,
    events: events.length,
    speakers: speakerCount,
    attendees: attendeeCount,
    users: existingUsers.map((u) => `${u.handle} <${u.email}>`),
    filesDeleted: keys.filter((k) => !referencedElsewhere.has(k)),
    filesKept: keys.filter((k) => referencedElsewhere.has(k)),
    uploadsDeleted: uploadKeys(urls.filter((u) => !uploadUsedElsewhere.has(u))),
    uploadsKept: uploadKeys(urls.filter((u) => uploadUsedElsewhere.has(u))),
  };

  if (opts.verbose) printRemoval(report, opts.dryRun);
  if (opts.dryRun) return report;

  // 顺序要紧：先删行（附件 / 讲师 / 参加记录随之消失），再删文件；反过来的话
  // 中途失败会留下指向不存在文件的行。演示同事账号最后删 —— 版块的主版主是
  // 真人，不会被牵连；活动此时已经删掉，不会走「删账号级联带走活动」那条路。
  if (zoneIds.length > 0) await prisma.zone.deleteMany({ where: { id: { in: zoneIds } } });
  if (eventIds.length > 0) await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
  for (const key of report.filesDeleted) {
    if (zoneMediaAbsPath(key)) await deleteZoneMediaFile(key);
  }
  if (report.uploadsDeleted.length > 0) {
    const { deleteImageFile } = await import('@/lib/uploads/image-storage');
    for (const key of report.uploadsDeleted) await deleteImageFile(key);
  }
  if (existingUsers.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: existingUsers.map((u) => u.id) } } });
  }
  return report;
}

function printRemoval(r: RemovalReport, dryRun: boolean): void {
  const head = dryRun ? '将会删除（--dry-run，什么都没动）' : '已删除';
  log(`\n▼ ${head}`);
  if (r.zones.length === 0 && r.events === 0 && r.users.length === 0) {
    log('  （什么都没有：演示内容当前未安装）');
    return;
  }
  for (const z of r.zones) log(`  版块      ${z}`);
  log(`  帖子      ${r.posts}`);
  log(`  附件      ${r.attachments}`);
  log(`  评论      ${r.comments}`);
  log(`  栏目      ${r.columns}`);
  log(`  Wiki 页   ${r.wikiPages}`);
  log(`  成员行    ${r.members}`);
  log(`  活动      ${r.events}`);
  log(`  讲师      ${r.speakers}`);
  log(`  参加记录  ${r.attendees}`);
  for (const u of r.users) log(`  演示账号  ${u}`);
  log(`  媒体文件  ${r.filesDeleted.length}（zone-media）`);
  for (const k of r.filesDeleted) log(`            - ${k}`);
  log(`  图片文件  ${r.uploadsDeleted.length}（uploads，活动封面与讲师头像）`);
  for (const k of r.uploadsDeleted) log(`            - ${k}`);
  const kept = [...r.filesKept, ...r.uploadsKept];
  if (kept.length > 0) {
    log(`  保留文件  ${kept.length}（还有非演示的行在引用，不删）`);
    for (const k of kept) log(`            = ${k}`);
  }
}

// ─── seed ───────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  const { prisma } = await import('@/lib/db');

  const owner = await resolveOwner();
  log(`▶ 发起人（版块主版主）：${owner.displayName} <${owner.email}>`);

  await assertAssets();
  assertEventBoundary();

  log('▶ 先清一遍旧的演示内容（幂等）…');
  await unseed({ dryRun: false, verbose: false });

  const people = await ensureDemoPeople();
  const byHandle = new Map(people.map((p) => [p.handle, p]));
  const uid = (handle: string): string => {
    const u = byHandle.get(handle);
    if (!u) throw new Error(`demo user missing: ${handle}`);
    return u.id;
  };

  // ── 版块 1：异构推理加速 ──────────────────────────────────────────────────
  const zoneA = await buildInferenceZone(owner.id);
  // ── 版块 2：图形渲染技术 ──────────────────────────────────────────────────
  const zoneB = await buildGraphicsZone(owner.id);

  // ── 成员与角色 ────────────────────────────────────────────────────────────
  const { addZoneMember } = await import('@/lib/zones/queries');
  const roleId = async (zoneId: string, key: string): Promise<string | null> => {
    const row = await prisma.zoneRole.findUnique({
      where: { zoneId_key: { zoneId, key } },
      select: { id: true },
    });
    return row?.id ?? null;
  };
  const memberships: Array<[string, string, string]> = [
    [zoneA.id, 'demo-lifang', 'moderator'],
    [zoneA.id, 'demo-chentuo', 'author'],
    [zoneA.id, 'demo-huangjing', 'author'],
    [zoneA.id, 'demo-wangsen', 'member'],
    [zoneA.id, 'demo-zhouke', 'member'],
    [zoneB.id, 'demo-zhouke', 'moderator'],
    [zoneB.id, 'demo-lifang', 'member'],
    [zoneB.id, 'demo-huangjing', 'author'],
  ];
  for (const [zoneId, handle, key] of memberships) {
    await addZoneMember(zoneId, uid(handle), await roleId(zoneId, key), owner.id, true);
  }
  log(`✓ 成员 ${memberships.length} 行（含 2 位版主）`);

  // ── 栏目 ──────────────────────────────────────────────────────────────────
  const { createOfficialColumn } = await import('@/lib/zones/columns');
  const columnsA = new Map<string, string>();
  for (const [name, desc] of [
    ['技术报告', '成体系的评测与结论，带完整方法与可复现材料。'],
    ['实验记录', '单次实验的过程与数据，结论可以是「还不确定」。'],
    ['论文精读', '读完一篇的笔记：它解决了什么、代价是什么。'],
    ['工具与流程', '脚本、模板、踩过的坑。'],
  ] as const) {
    const col = await createOfficialColumn(zoneA.id, { name, description: desc }, owner.id);
    columnsA.set(name, col.id);
  }
  const columnsB = new Map<string, string>();
  for (const [name, desc] of [
    ['渲染管线', '管线各阶段的剖析与改动记录。'],
    ['性能剖析', '帧预算、抓帧、掉帧分布。'],
    ['论文精读', '图形与并行计算方向的论文笔记。'],
  ] as const) {
    const col = await createOfficialColumn(zoneB.id, { name, description: desc }, owner.id);
    columnsB.set(name, col.id);
  }
  log(`✓ 栏目 ${columnsA.size + columnsB.size} 个`);

  // ── Wiki（版规 + 实验规范）────────────────────────────────────────────────
  const { createWikiPage } = await import('@/lib/zones/wiki-queries');
  // slug 'rules' 是固定值：右栏的「版规」手风琴按 lib/zones/rules.ts 读这一页。
  await createWikiPage(zoneA.id, { title: '版规', slug: 'rules', bodyMd: RULES_MD, note: '初版' }, owner.id);
  await createWikiPage(
    zoneA.id,
    { title: '实验规范', slug: 'experiment-protocol', bodyMd: PROTOCOL_MD, note: '初版' },
    owner.id,
  );
  await createWikiPage(zoneB.id, { title: '版规', slug: 'rules', bodyMd: RULES_MD_GRAPHICS, note: '初版' }, owner.id);
  log('✓ Wiki 3 页（含两个版块的版规）');

  // ── 帖子 ──────────────────────────────────────────────────────────────────
  //
  // 顺序有依赖：B 先建，A 才能用 [embed:post:B]；A 建完，C 才能跨版块引用 A。
  const postB = await buildPostBatching(zoneA, uid, columnsA.get('实验记录') ?? null);
  const postA = await buildPostEval(zoneA, uid, columnsA.get('技术报告') ?? null, postB);
  const postC = await buildPostFrame(zoneB, uid, columnsB.get('性能剖析') ?? null, postA);
  log(`✓ 帖子 3 篇（A=${postA} B=${postB} C=${postC}）`);

  // ── 置顶 ──────────────────────────────────────────────────────────────────
  const { setZonePostFlags } = await import('@/lib/zones/post-queries');
  await setZonePostFlags(postA, { pinned: true });

  // ── 精选 ──────────────────────────────────────────────────────────────────
  //
  // 这一段一度是关着的：/zones?tab=boards 的「精选」带把 keyOf/render 两个函数从 RSC
  // 直接传给客户端组件，只要 featured 列表非空整页就崩。那是个先前就在、只是从没被
  // 触发过的应用 bug（库里一个精选版块都没有），现在已经修好（ZoneFeaturedStrip），
  // 所以演示版块可以正常进精选带。拆除时 unseedZones 连版块一起删，不留残留。
  await prisma.zone.updateMany({
    where: { slug: { in: [ZONE_INFERENCE, ZONE_GRAPHICS] } },
    data: { featured: true, featuredAt: new Date() },
  });

  // ── 评论 / 点赞 / 收藏 ────────────────────────────────────────────────────
  await buildEngagement({ postA, postB, postC, uid, ownerId: owner.id, zoneA: zoneA.id, zoneB: zoneB.id });

  // ── 活动 ──────────────────────────────────────────────────────────────────
  await buildEvents(uid, owner.id);

  // ── 时间线回填 ────────────────────────────────────────────────────────────
  await backdate({ zoneA: zoneA.id, zoneB: zoneB.id, postA, postB, postC });

  // 办公文档的 PDF 转换是 fire-and-forget 的；给它一点时间落地，免得脚本退出后
  // 页面上永远挂着「转换中」。没有 LibreOffice 时它会自己转成 failed，
  // 预览面板照样有 pptx 的逐页 HTML 兜底。
  await settleOfficePreviews();

  log('\n✓ 演示内容已安装');
  log(`  /zones/${ZONE_INFERENCE}`);
  log(`  /zones/${ZONE_GRAPHICS}`);
  log(`  /events（${DEMO_EVENTS.length} 个活动，往期与即将举行都有）`);
  log('  拆除：pnpm demo:unseed（先 --dry-run 看会删什么）');
}

// ─── 发起人 / 演示同事 ──────────────────────────────────────────────────────

async function resolveOwner(): Promise<{ id: string; email: string; displayName: string }> {
  const { prisma } = await import('@/lib/db');
  const wanted = (process.env.DEMO_OWNER_EMAIL ?? '').trim().toLowerCase();

  if (wanted) {
    const row = await prisma.user.findFirst({
      where: { email: wanted, isActive: true },
      select: { id: true, email: true, displayName: true },
    });
    if (!row) throw new Error(`DEMO_OWNER_EMAIL=${wanted} 找不到，或该账号已停用。`);
    return row;
  }

  // 没指定就用最早的一个在用超级管理员 —— 演示版块归他，「我的版块」里看得见。
  const superAdmins = await prisma.user.findMany({
    where: { isActive: true, role: { key: 'super_admin' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, displayName: true },
  });
  if (superAdmins.length > 0) return superAdmins[0];

  throw new Error(
    '这个库里没有在用的超级管理员，脚本不敢自己挑一个人当版块主版主。\n' +
      '  请先 `pnpm db:seed` 或 `pnpm roles:sync`，或显式指定：\n' +
      '  DEMO_OWNER_EMAIL=you@example.com pnpm demo:seed',
  );
}

async function ensureDemoPeople(): Promise<Array<{ id: string; handle: string }>> {
  const { prisma } = await import('@/lib/db');
  const bcrypt = (await import('bcryptjs')).default;

  // 默认给一个谁也不知道的随机口令（演示账号不该能登录）。真要拿它们演示
  // 「换个人看」，运行时给 DEMO_USER_PASSWORD —— 刻意不写死在仓库里。
  const plain = (process.env.DEMO_USER_PASSWORD ?? '').trim();
  const passwordHash = await bcrypt.hash(
    plain || `demo-${Math.random().toString(36).slice(2)}${Date.now()}`,
    10,
  );

  const out: Array<{ id: string; handle: string }> = [];
  for (const p of DEMO_PEOPLE) {
    // 没有「建用户」的 lib 入口（自助注册已关闭，管理后台也没有建号 UI），
    // scripts/seed.ts 同样是直接写 User 行。
    const row = await prisma.user.upsert({
      where: { email: p.email },
      update: {
        handle: p.handle,
        displayName: p.displayName,
        department: p.department,
        lab: INSTITUTE,
        bio: p.bio,
        isActive: true,
      },
      create: {
        email: p.email,
        handle: p.handle,
        displayName: p.displayName,
        department: p.department,
        lab: INSTITUTE,
        bio: p.bio,
        passwordHash,
        authMethod: 'password',
        isActive: true,
        // 演示账号不该出现在「可创建版块」的名单里。
        canCreateZones: false,
      },
      select: { id: true, handle: true },
    });
    out.push(row);
  }
  log(`✓ 演示同事 ${out.length} 位（${DEMO_PEOPLE.map((p) => p.displayName).join(' / ')}）`);
  return out;
}

// ─── 资产 → zone-media ──────────────────────────────────────────────────────

type MediaKind = 'image' | 'file' | 'cover' | 'icon';

async function assertAssets(): Promise<void> {
  if (!fs.existsSync(ASSET_DIR)) {
    throw new Error(
      `找不到演示资产目录：${ASSET_DIR}\n` +
        '  请在仓库根目录运行（pnpm demo:seed 会自动这么做），\n' +
        '  资产缺失时用 `python3 scripts/demo/make-assets.py` 重新生成。',
    );
  }
}

/**
 * 删除边界 (2) 的自检：`DEMO_EVENTS` 与 `DEMO_EVENT_IDS` 必须互相覆盖。
 *
 * 这不是洁癖 —— 边界写在文件开头才有意义，而「表里加了一个活动、开头那串忘了
 * 加」的后果是 unseed 悄悄删不干净。宁可在 seed 的第一秒炸掉。
 */
function assertEventBoundary(): void {
  const declared = new Set<string>(DEMO_EVENT_IDS);
  const defined = DEMO_EVENTS.map((e) => e.id);
  const dupes = defined.filter((id, i) => defined.indexOf(id) !== i);
  const missing = defined.filter((id) => !declared.has(id));
  const orphan = [...declared].filter((id) => !defined.includes(id));
  if (dupes.length || missing.length || orphan.length) {
    throw new Error(
      '演示活动的删除边界对不上（DEMO_EVENT_IDS ↔ DEMO_EVENTS）：\n' +
        (dupes.length ? `  重复的 id：${dupes.join(', ')}\n` : '') +
        (missing.length ? `  表里有、边界里没有：${missing.join(', ')}\n` : '') +
        (orphan.length ? `  边界里有、表里没有：${orphan.join(', ')}\n` : ''),
    );
  }
}

/** 把 assets 里的一个文件拷进 zone-media，返回新 key。 */
async function putAsset(kind: MediaKind, filename: string): Promise<string> {
  const { newZoneMediaKey, zoneMediaAbsPath, zoneMediaExtFor } = await import('@/lib/zones/storage');
  const src = path.join(ASSET_DIR, filename);
  const stat = await fsp.stat(src).catch(() => null);
  if (!stat?.isFile()) throw new Error(`演示资产缺失：${src}（跑一次 scripts/demo/make-assets.py）`);

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const key = newZoneMediaKey(kind, zoneMediaExtFor(kind, MIME_BY_EXT[ext] ?? '', filename));
  const abs = zoneMediaAbsPath(key);
  if (!abs) throw new Error(`unsafe media key: ${key}`);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.copyFile(src, abs);
  return key;
}

interface AttachmentSpec {
  key: string;
  /** 读者看到的文件名（中文），扩展名决定预览分支。 */
  name: string;
  mimeType: string;
}

async function attachment(filename: string, displayName: string, kind: 'file' | 'image'): Promise<AttachmentSpec> {
  const key = await putAsset(kind, filename);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return { key, name: displayName, mimeType: MIME_BY_EXT[ext] ?? '' };
}

// ─── 资产 → uploads/images（活动的图片走这里，不是 zone-media）─────────────
//
// `Event.coverUrl` / `EventSpeaker.avatarUrl` 由 eventContentSchema 校验，只收
// `''` / `https?://` / `/api/uploads/…` 三种，也就是通用图片存储那一套
// （lib/uploads/image-storage.ts）。所以活动的封面与头像跟版块的附件是**两个
// 存储根**，unseed 也分别统计、分别校验。

/** 把 assets 里的一张图拷进 uploads/images，返回入库用的 URL。 */
async function putUploadAsset(filename: string): Promise<string> {
  const { newImageKey, uploadFileAbsPath, imagePublicUrl } = await import('@/lib/uploads/image-storage');
  const src = path.join(ASSET_DIR, filename);
  const stat = await fsp.stat(src).catch(() => null);
  if (!stat?.isFile()) throw new Error(`演示资产缺失：${src}（跑一次 scripts/demo/make-assets.py）`);

  // 扩展名必须落在下面 UPLOAD_IMAGE_KEY_RE 认得的那一组里 —— 写进去的 key
  // 必须是 unseed 反解得回来的 key，否则文件就成了删不掉的孤儿。宁可这里报错。
  const raw = filename.split('.').pop()?.toLowerCase() ?? '';
  const ext = raw === 'jpeg' ? 'jpg' : raw;
  if (!['jpg', 'png', 'webp', 'avif', 'gif'].includes(ext)) {
    throw new Error(`演示资产 ${filename} 不是图片：活动封面 / 讲师头像只能是图片。`);
  }
  const key = newImageKey(ext);
  const abs = uploadFileAbsPath(key);
  if (!abs) throw new Error(`unsafe upload key: ${key}`);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.copyFile(src, abs);
  return imagePublicUrl(key);
}

/**
 * `/api/uploads/images/<id>.jpg` → `images/<id>.jpg`，其它一律 null。
 *
 * 通用图片存储没有 `zoneMediaKeyFromUrl` 那样的反解函数（只有 lib/stickers.ts
 * 给表情包写了一个同形状的），所以这里照 `stickerKeyFromSrc` 抄一份，收窄到
 * `images/` 命名空间：外链头像、脏数据都会返回 null，自然不会进删除候选集。
 */
const UPLOAD_IMAGE_KEY_RE = /^images\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|avif|gif)$/;

function uploadKeyFromUrl(url: string | null | undefined): string | null {
  const v = url ?? '';
  if (!v.startsWith('/api/uploads/')) return null;
  let rest = v.slice('/api/uploads/'.length);
  try {
    rest = rest
      .split('/')
      .map((seg) => decodeURIComponent(seg))
      .join('/');
  } catch {
    return null;
  }
  return UPLOAD_IMAGE_KEY_RE.test(rest) ? rest : null;
}

// ─── 版块 ───────────────────────────────────────────────────────────────────

interface ZoneRef {
  id: string;
  slug: string;
  name: string;
  ownerId: string;
  visibility: 'public' | 'members';
  joinPolicy: 'open' | 'approval' | 'invite';
  allowGuestComments: boolean;
  deletedAt: Date | null;
}

async function loadZoneRef(slug: string): Promise<ZoneRef> {
  const { prisma } = await import('@/lib/db');
  const { ZONE_ACCESS_SELECT } = await import('@/lib/zones/access');
  const row = await prisma.zone.findUniqueOrThrow({ where: { slug }, select: ZONE_ACCESS_SELECT });
  return row;
}

async function buildInferenceZone(ownerId: string): Promise<ZoneRef> {
  const { createZone, updateZone } = await import('@/lib/zones/queries');
  await createZone(
    {
      name: '异构推理加速',
      slug: ZONE_INFERENCE,
      tagline: '把一次推理拆开计时，再决定该拧哪个旋钮。',
      descriptionMd: ZONE_A_ABOUT,
      lab: INSTITUTE, // 研究所
      department: LAB_CDAA, // 实验室
      visibility: 'public',
      joinPolicy: 'open',
      allowGuestComments: true,
      allowMemberColumns: true,
      links: [
        { label: 'vLLM', url: 'https://github.com/vllm-project/vllm' },
        { label: 'FlashAttention 论文', url: 'https://arxiv.org/abs/2205.14135' },
      ],
    },
    ownerId,
  );
  const zone = await loadZoneRef(ZONE_INFERENCE);
  await updateZone(zone.id, { coverKey: await putAsset('cover', 'zone-cover-inference.jpg') });
  log(`✓ 版块 /zones/${ZONE_INFERENCE}（${INSTITUTE} · ${LAB_CDAA}）`);
  return zone;
}

async function buildGraphicsZone(ownerId: string): Promise<ZoneRef> {
  const { createZone, updateZone } = await import('@/lib/zones/queries');
  await createZone(
    {
      name: '图形渲染技术',
      slug: ZONE_GRAPHICS,
      tagline: '一帧 16.6 毫秒，钱花在哪儿要能说清楚。',
      descriptionMd: ZONE_B_ABOUT,
      lab: INSTITUTE,
      department: LAB_GRAPHICS,
      visibility: 'public',
      joinPolicy: 'approval',
      allowGuestComments: true,
      allowMemberColumns: false,
      links: [
        { label: 'Vulkan 规范', url: 'https://registry.khronos.org/vulkan/' },
        { label: 'RenderDoc', url: 'https://renderdoc.org/' },
      ],
    },
    ownerId,
  );
  const zone = await loadZoneRef(ZONE_GRAPHICS);
  await updateZone(zone.id, { coverKey: await putAsset('cover', 'zone-cover-graphics.jpg') });
  log(`✓ 版块 /zones/${ZONE_GRAPHICS}（${INSTITUTE} · ${LAB_GRAPHICS}）`);
  return zone;
}

// ─── 帖子 ───────────────────────────────────────────────────────────────────

type Uid = (handle: string) => string;

/** ZonePostInput 的必填字段一个都不能少，这里给一份默认值。 */
function postInput(over: {
  title: string;
  summary: string;
  bodyMd: string;
  coverKey: string | null;
  tags: string[];
  coauthorIds: string[];
  attachments: Array<{ key: string; name: string; mimeType: string }>;
  columnId: string | null;
}) {
  return {
    type: 'article' as const,
    linkUrl: null,
    status: 'published' as const,
    columnName: null,
    visibility: 'zone' as const,
    designatedUserIds: [] as string[],
    regenerateAccessCode: false,
    ...over,
    attachments: over.attachments.map((a) => ({ ...a, sizeBytes: 0 })),
  };
}

async function buildPostBatching(zone: ZoneRef, uid: Uid, columnId: string | null): Promise<string> {
  const { createZonePost } = await import('@/lib/zones/post-queries');
  const { zoneMediaPublicUrl } = await import('@/lib/zones/storage');

  const deck = await attachment('deck-batching.pptx', '批处理调度实验记录_汇报胶片.pptx', 'file');
  const figQueue = await attachment('fig-queue.png', '请求时间构成.png', 'image');
  const cover = await putAsset('image', 'post-cover-batching.jpg');

  const body = [
    '> 演示材料：下面所有数字都是为讲清楚方法构造的样例，不代表任何真实产品的评测结论。',
    '',
    '## 这一次只动一个变量',
    '',
    '同一个模型、同一台机器、同一份输入分布，只切换调度策略：',
    '',
    '- **静态批处理**：凑满一批再发，批内所有请求同生共死；',
    '- **连续批处理**：解码到哪一步都能插入新请求，谁先结束谁先走。',
    '',
    '关心的还是那三个数：吞吐、P50、P99。',
    '',
    '## 观察到的形状',
    '',
    `![一次请求的时间构成](${zoneMediaPublicUrl(figQueue.key)})`,
    '',
    '| 并发 | 静态批处理 吞吐 | 连续批处理 吞吐 | 静态 P99 | 连续 P99 |',
    '| --- | ---: | ---: | ---: | ---: |',
    '| 4 | 1 180 | 1 240 | 132 ms | 128 ms |',
    '| 16 | 2 640 | 3 010 | 268 ms | 196 ms |',
    '| 32 | 3 180 | 4 220 | 512 ms | 284 ms |',
    '| 64 | 3 260 | 5 090 | 1 140 ms | 392 ms |',
    '',
    '三条能说出口的观察：',
    '',
    '1. 低并发下两者差不多，静态批处理甚至略稳一点 —— 没有插队，抖动就小；',
    '2. 并发一高，**多出来的时间几乎全落在排队上**，计算部分基本没动；',
    '3. 静态批处理的 P99 是被同批里最长的那条请求拖住的，这一点在长短混合的真实流量里最难受。',
    '',
    '## 复现用的配置',
    '',
    `${FENCE}yaml`,
    'scheduler:',
    '  policy: continuous      # 对照组改成 static',
    '  max_num_seqs: 32',
    '  max_num_batched_tokens: 8192',
    '  preemption: recompute   # 显存吃紧时重算，不换出',
    'workload:',
    '  in_len: [256, 1024, 2048]   # 长短混合，别只测等长',
    '  out_len: 128',
    '  arrival: poisson',
    '  repeat: 5',
    `${FENCE}`,
    '',
    '统计口径写死在脚本里，免得每个人各算各的：',
    '',
    `${FENCE}python`,
    'def summarize(samples: list[float]) -> dict[str, float]:',
    '    """丢掉预热轮，取中位数与 P99 —— 平均值会被长尾拖着走。"""',
    '    xs = sorted(samples[1:])',
    '    return {"p50": xs[len(xs) // 2], "p99": xs[int(len(xs) * 0.99)]}',
    `${FENCE}`,
    '',
    '## 汇报用的那版胶片',
    '',
    '',
    `[embed:file:${deck.key}]`,
    '',
    '## 还没想清楚的',
    '',
    '- 抢占策略选「重算」还是「换出」，我们只测了前者；',
    '- 长短混合的比例是拍脑袋定的，换个比例结论会不会翻，需要再跑一轮。',
  ].join('\n');

  const created = await createZonePost(
    zone,
    uid('demo-chentuo'),
    postInput({
      title: '批处理调度实验记录：连续批处理 vs 静态批处理',
      summary: '同一套硬件与输入分布下只切换调度策略，看吞吐与尾延迟各自怎么走。数据为构造样例。',
      bodyMd: body,
      coverKey: cover,
      tags: ['调度', '批处理', '实验记录'],
      coauthorIds: [uid('demo-lifang')],
      attachments: [deck, figQueue],
      columnId,
    }),
    { canModerate: true },
  );
  return created.id;
}

async function buildPostEval(zone: ZoneRef, uid: Uid, columnId: string | null, siblingPostId: string): Promise<string> {
  const { createZonePost } = await import('@/lib/zones/post-queries');
  const { zoneMediaPublicUrl } = await import('@/lib/zones/storage');

  const pdf = await attachment('report-inference-eval.pdf', '异构推理加速_阶段评测报告.pdf', 'file');
  const xlsx = await attachment('bench-matrix.xlsx', '评测矩阵_原始数据.xlsx', 'file');
  const csv = await attachment('bench-matrix.csv', '评测矩阵_原始数据.csv', 'file');
  const figPipeline = await attachment('fig-pipeline.png', '推理服务分层示意.png', 'image');
  const figLatency = await attachment('fig-latency.png', '批大小与端到端延迟.png', 'image');
  const cover = await putAsset('image', 'post-cover-quant.jpg');

  const body = [
    '> 演示材料：下面所有数字都是为讲清楚方法构造的样例，不代表任何真实产品的评测结论。',
    '',
    '## 我们想回答什么',
    '',
    '这两类改动几乎总是被一起提出来：',
    '',
    '1. **算子融合** —— 把 Attention 与 MLP 的若干步合成一个内核，少走一次显存往返；',
    '2. **权重 INT4 量化** —— 权重降到 4 bit，激活保持 FP16。',
    '',
    '单独做都有人测过，但「一起做」的收益是不是相加，我们手上没有一张能对齐的表。',
    '这一轮就是把它们放到同一套基线上跑一遍，顺便把口径固定下来。',
    '',
    '## 方法：先把链路拆开计时',
    '',
    `![推理服务分层示意](${zoneMediaPublicUrl(figPipeline.key)})`,
    '',
    '每一层单独计时，任何一层的改动都落在同一张基线上比较 —— 这是后面所有结论成立的前提。',
    '完整配置见附件报告第 2 节，这里只列关键项：',
    '',
    '| 配置 | 批大小 | 吞吐 (tok/s) | P50 | P99 | 显存峰值 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    '| FP16 基线 | 8 | 2 180 | 71 ms | 148 ms | 16.4 GB |',
    '| ＋算子融合 | 8 | 2 560 | 63 ms | 133 ms | 16.1 GB |',
    '| ＋INT4 量化 | 8 | 2 910 | 57 ms | 126 ms | 9.9 GB |',
    '| 融合 ＋ INT4 | 8 | 3 120 | 54 ms | 119 ms | 9.7 GB |',
    '',
    '跑法：',
    '',
    `${FENCE}bash`,
    'python bench/run.py \\',
    '  --model demo-7b --dtype fp16 \\',
    '  --batch 1,2,4,8,16,32,64 \\',
    '  --in-len 1024 --out-len 128 \\',
    '  --repeat 5 --drop-first \\',
    '  --report out/baseline.json',
    `${FENCE}`,
    '',
    '## 观察',
    '',
    '',
    `[embed:file:${figLatency.key}]`,
    '',
    '- 吞吐随批大小单调上升，**P99 上升得更快**；',
    '- 融合的收益随批大小衰减 —— 批一大，瓶颈就从访存挪到了算力；',
    '- 两项叠加**不是简单相加**：它们省的是同一份显存带宽。',
    '',
    '> 换句话说，批大小不是一个可以一直拧的旋钮。先撞线的通常是延迟预算，不是吞吐。',
    '',
    '## 材料',
    '',
    '完整报告与原始数据都挂在下面，点开就在右侧阅读面板里翻，不用下载：',
    '',
    `[embed:file:${pdf.key}]`,
    '',
    '原始数据给了两份 —— xlsx 是归档用的，csv 是给「懒得下载、就想扫一眼」的人准备的：',
    '',
    `[embed:file:${csv.key}]`,
    '',
    `[embed:file:${xlsx.key}]`,
    '',
    '调度侧的对照实验是另一篇，两边的口径是同一套：',
    '',
    `[embed:post:${siblingPostId}]`,
    '',
    '## 遗留问题',
    '',
    '- 低批场景下融合内核的收益还没稳定复现，怀疑跟内核启动开销在同一量级；',
    '- 量化误差在长上下文下的累积缺少长跑数据，这一轮没跑够时间。',
    '',
    '打包与工具链那一段我只覆盖到了产物落盘，剩下的请 [@王森](/users/demo-wangsen) 在评论区补一下。',
  ].join('\n');

  const created = await createZonePost(
    zone,
    uid('demo-lifang'),
    postInput({
      title: '算子融合与 INT4 量化的联合评测',
      summary: '把两类常被一起提出的改动放到同一套基线上，拆开每一层计时，看叠加后的收益到底是不是相加。数据为构造样例。',
      bodyMd: body,
      coverKey: cover,
      tags: ['量化', '算子融合', '评测', '技术报告'],
      coauthorIds: [uid('demo-chentuo')],
      attachments: [pdf, csv, xlsx, figPipeline, figLatency],
      columnId,
    }),
    { canModerate: true },
  );
  return created.id;
}

async function buildPostFrame(zone: ZoneRef, uid: Uid, columnId: string | null, crossPostId: string): Promise<string> {
  const { createZonePost } = await import('@/lib/zones/post-queries');
  const { zoneMediaPublicUrl } = await import('@/lib/zones/storage');

  const figFrame = await attachment('fig-frame-budget.png', '一帧的时间去向.png', 'image');
  const checklist = await attachment('checklist-frame-budget.md', '帧预算排查清单.md', 'file');
  const cover = await putAsset('image', 'post-cover-frame.jpg');

  const body = [
    '> 演示材料：数字为构造样例，用来说明排查方法。',
    '',
    '## 一帧 16.6 毫秒，钱花在哪儿',
    '',
    '先把一帧拆开，再谈优化。没有这张图之前，讨论「卡不卡」全靠感觉：',
    '',
    `![一帧的时间去向](${zoneMediaPublicUrl(figFrame.key)})`,
    '',
    '| 阶段 | 耗时 | 占比 | 第一反应 |',
    '| --- | ---: | ---: | --- |',
    '| 几何提交 | 2.4 ms | 14% | 合批被材质切换打断了吗 |',
    '| 阴影通道 | 4.1 ms | 25% | 远处级联的分辨率是不是给高了 |',
    '| 光照合成 | 5.2 ms | 31% | 中间纹理能不能降精度 |',
    '| 后处理 | 2.6 ms | 16% | 相邻通道能不能合并 |',
    '| 呈现等待 | 2.3 ms | 14% | 看分布，别看均值 |',
    '',
    '## 计时怎么打',
    '',
    '每个阶段一对时间戳，跨阶段的空档单独记一条 —— 空档才是最容易被漏掉的那部分：',
    '',
    `${FENCE}cpp`,
    '// 每一帧写入一个环形缓冲，落盘由另一个线程做，避免把测量本身算进预算。',
    'struct StageMark { uint32_t stage; uint64_t gpu_ticks; };',
    '',
    'void BeginStage(CommandBuffer& cb, Stage s) {',
    '  cb.WriteTimestamp(query_pool_, QueryIndex(s, Phase::Begin));',
    '}',
    'void EndStage(CommandBuffer& cb, Stage s) {',
    '  cb.WriteTimestamp(query_pool_, QueryIndex(s, Phase::End));',
    '}',
    `${FENCE}`,
    '',
    '## 排查清单',
    '',
    '每次抓帧照着走一遍，省得每个人凭记忆各查各的：',
    '',
    `[embed:file:${checklist.key}]`,
    '',
    '## 方法是从隔壁借的',
    '',
    '「逐阶段计时 + 固定基线」这套做法，是从推理加速那边的评测里直接搬过来的，',
    '连「丢掉首轮预热」这种细节都一样。跨方向能共用的东西比想象中多：',
    '',
    `[embed:post:${crossPostId}]`,
    '',
    '## 下一步',
    '',
    '- 把这张图接进常态化回归，每天出一张，而不是出问题了才抓；',
    '- 呈现等待那一格现在只有均值，需要补掉帧分布。',
  ].join('\n');

  const created = await createZonePost(
    zone,
    uid('demo-zhouke'),
    postInput({
      title: '移动端渲染管线剖析：从 GPU 计时到帧预算',
      summary: '把一帧拆成五个阶段分别计时，先看清时间花在哪儿再谈优化。数据为构造样例。',
      bodyMd: body,
      coverKey: cover,
      tags: ['渲染管线', '性能剖析', '帧预算'],
      coauthorIds: [uid('demo-huangjing')],
      attachments: [figFrame, checklist],
      columnId,
    }),
    { canModerate: true },
  );
  return created.id;
}

// ─── 评论 / 点赞 / 收藏 ─────────────────────────────────────────────────────
//
// 这三件事都没有 lib 级的写入口 —— 唯一的写法在 API 路由里
// （app/api/zones/[slug]/posts/[postId]/comments/route.ts 和同目录的 like /
// bookmark 路由）。这里照抄那几个路由的事务形状：建行 + 计数器自增 +
// 版块 lastActivityAt，回复还要给根评论 replyCount 自增。
// 通知刻意不发：路由里的 notifyZoneReply 会走邮件，演示不该往真人信箱塞东西
// （@人 / 合著者通知是站内信，由 createZonePost 正常触发，收件人全是演示账号）。

async function buildEngagement(o: {
  postA: string;
  postB: string;
  postC: string;
  uid: Uid;
  ownerId: string;
  zoneA: string;
  zoneB: string;
}): Promise<void> {
  const { prisma } = await import('@/lib/db');

  let roots = 0;
  let replies = 0;
  const comment = async (
    postId: string,
    zoneId: string,
    handle: string,
    bodyMd: string,
    parentId?: string,
  ): Promise<string> => {
    if (parentId) replies += 1;
    else roots += 1;
    const [row] = await prisma.$transaction([
      prisma.zonePostComment.create({
        data: { postId, authorId: o.uid(handle), parentId: parentId ?? null, bodyMd },
        select: { id: true },
      }),
      prisma.zonePost.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } }),
      prisma.zone.update({ where: { id: zoneId }, data: { lastActivityAt: new Date() } }),
      ...(parentId
        ? [prisma.zonePostComment.update({ where: { id: parentId }, data: { replyCount: { increment: 1 } } })]
        : []),
    ]);
    return row.id;
  };

  const t1 = await comment(
    o.postA,
    o.zoneA,
    'demo-zhouke',
    '低批那段我们在渲染侧也撞过一模一样的墙：改动本身的收益跟一次内核启动的开销在同一量级，测出来全是噪声。\n\n我们后来的做法是把同一个内核连跑 N 次再除，虽然不完全等价，但至少能看出方向。',
  );
  await comment(
    o.postA,
    o.zoneA,
    'demo-lifang',
    '对，我们这轮也开始单独计内核启动了，下一版报告会把这一项拆出来单列。谢谢提醒 —— 「连跑 N 次再除」这个我去试一下，如果站得住就写进实验规范。',
    t1,
  );

  const t2 = await comment(
    o.postA,
    o.zoneA,
    'demo-huangjing',
    '表里的 P99 是端到端还是只算解码？两种口径差得挺多，回归基线上得统一。',
  );
  await comment(
    o.postA,
    o.zoneA,
    'demo-chentuo',
    '端到端，含排队。口径写在附件报告第 2 节，也固定在 `summarize()` 里了；只算解码的那版我们内部叫「纯算」，不进对外的表。',
    t2,
  );

  await comment(
    o.postA,
    o.zoneA,
    'demo-wangsen',
    '被点名了，补一段工具链的：\n\n1. INT4 权重的打包格式我们换过一次，旧产物在新内核上会静默走慢路径，跑分之前先确认版本；\n2. 融合内核目前只在特定编译选项下生成，`-O2` 以下会退化成两个内核 —— 这个坑我踩过两次。',
  );

  await comment(
    o.postB,
    o.zoneA,
    'demo-huangjing',
    '长短混合的比例建议直接从线上采一天的分布，别自己拍。我们这边有现成的采样脚本，需要的话我贴到「工具与流程」栏目里。',
  );

  await comment(
    o.postC,
    o.zoneB,
    'demo-lifang',
    '这张「一帧的去向」很好用。我们那边其实也缺一张同构的图 —— 一次请求的时间去向，回头照着做一版。',
  );

  // 点赞 / 收藏：跟评论同一个理由，只有路由里有写法（守卫式事务 + 计数器）。
  const likes: Array<[string, string[]]> = [
    [o.postA, ['demo-zhouke', 'demo-huangjing', 'demo-wangsen', 'demo-chentuo']],
    [o.postB, ['demo-lifang', 'demo-huangjing']],
    [o.postC, ['demo-lifang', 'demo-huangjing', 'demo-chentuo']],
  ];
  for (const [postId, handles] of likes) {
    await prisma.$transaction([
      prisma.zonePostLike.createMany({
        data: handles.map((h) => ({ postId, userId: o.uid(h) })),
        skipDuplicates: true,
      }),
      prisma.zonePost.update({ where: { id: postId }, data: { likeCount: handles.length } }),
    ]);
  }
  const bookmarks: Array<[string, string[]]> = [
    [o.postA, ['demo-huangjing', 'demo-zhouke']],
    [o.postC, ['demo-chentuo']],
  ];
  for (const [postId, handles] of bookmarks) {
    await prisma.$transaction([
      prisma.zonePostBookmark.createMany({
        data: handles.map((h) => ({ postId, userId: o.uid(h) })),
        skipDuplicates: true,
      }),
      prisma.zonePost.update({ where: { id: postId }, data: { bookmarkCount: handles.length } }),
    ]);
  }
  const likeTotal = likes.reduce((n, [, hs]) => n + hs.length, 0);
  const bookmarkTotal = bookmarks.reduce((n, [, hs]) => n + hs.length, 0);
  log(`✓ 评论 ${roots + replies} 条（含 ${replies} 条回复）、点赞 ${likeTotal}、收藏 ${bookmarkTotal}`);
}

// ─── 时间线 ─────────────────────────────────────────────────────────────────
//
// 全部内容都盖着「刚刚」的时间戳，一眼就能看出是刷进去的。没有产品路径可以改
// 创建时间，所以这里直接写行 —— 影响范围仅限演示自己的行。

async function backdate(o: { zoneA: string; zoneB: string; postA: string; postB: string; postC: string }): Promise<void> {
  const { prisma } = await import('@/lib/db');

  const plan: Array<[string, Date]> = [
    [o.postB, daysAgo(9, 16, 20)],
    [o.postA, daysAgo(5, 11, 5)],
    [o.postC, daysAgo(2, 15, 40)],
  ];
  for (const [id, when] of plan) {
    await prisma.zonePost.update({ where: { id }, data: { createdAt: when, publishedAt: when } });
  }

  // 评论排在自己那篇帖子之后，最新的一条决定版块的 lastActivityAt。
  const comments = await prisma.zonePostComment.findMany({
    where: { postId: { in: [o.postA, o.postB, o.postC] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, postId: true },
  });
  const base = new Map<string, Date>(plan);
  const seen = new Map<string, number>();
  for (const c of comments) {
    const n = (seen.get(c.postId) ?? 0) + 1;
    seen.set(c.postId, n);
    const start = base.get(c.postId) ?? daysAgo(3);
    await prisma.zonePostComment.update({
      where: { id: c.id },
      data: { createdAt: new Date(start.getTime() + n * 7 * 60 * 60 * 1000) },
    });
  }

  // 演示同事的注册时间也往前挪一点 —— 个人主页会写「注册于 6 分钟前」。
  await prisma.user.updateMany({
    where: { email: { in: DEMO_EMAILS } },
    data: { createdAt: daysAgo(64, 9, 0), lastSeenAt: daysAgo(1, 17, 30) },
  });

  // 版块的「最近活跃」必须等于它里面最新的那条内容的时间，否则侧栏会写着
  // 「1 天前活跃」而最新的帖子是五天前的 —— 一眼假。
  for (const [zoneId, createdAt] of [
    [o.zoneA, daysAgo(38, 9, 30)],
    [o.zoneB, daysAgo(24, 14, 10)],
  ] as Array<[string, Date]>) {
    const [newestPost, newestComment] = await Promise.all([
      prisma.zonePost.findFirst({
        where: { zoneId },
        orderBy: { publishedAt: 'desc' },
        select: { publishedAt: true },
      }),
      prisma.zonePostComment.findFirst({
        where: { post: { zoneId } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    const stamps = [newestPost?.publishedAt, newestComment?.createdAt].filter((d): d is Date => !!d);
    const lastActivityAt = stamps.length
      ? new Date(Math.max(...stamps.map((d) => d.getTime())))
      : createdAt;
    await prisma.zone.update({ where: { id: zoneId }, data: { createdAt, lastActivityAt } });
  }
}

// ─── 办公文档预览 ───────────────────────────────────────────────────────────

async function settleOfficePreviews(): Promise<void> {
  const { prisma } = await import('@/lib/db');
  const deadline = Date.now() + 25_000;
  for (;;) {
    const pending = await prisma.zonePostAttachment.count({
      where: { previewStatus: 'pending', post: { zone: { slug: { in: [...DEMO_ZONE_SLUGS] } } } },
    });
    if (pending === 0) return;
    if (Date.now() > deadline) {
      log(`  （还有 ${pending} 个附件在转 PDF；没装 LibreOffice 时它会自己转成失败，pptx 仍有逐页 HTML 兜底）`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 活动（Events）
// ═══════════════════════════════════════════════════════════════════════════
//
// 时间是这一段唯一的难点，两条规矩：
//
//  1. **日期相对「今天」算，不写死。** 脚本可能在三个月后才第一次在内网跑起来，
//     写死日期的话「即将举行」会整片变成往期。`DemoEventSpec.startDay` 是相对
//     今天的天数，`dayIn()` 把它换算成**活动自己那个时区**的挂钟日期。
//  2. **定时活动的瞬时由 `composeEventData` 算**，也就是 `POST /api/events` 用的
//     那一份 —— 它内部走 `zonedWallToUtc`（全站唯一一份 DST 感知换算）。这里
//     绝不出现 `new Date('2026-03-05T10:00')`：那是按运行机器的时区解释的，
//     加西排的场到多伦多就差三小时。全天活动是另一套：只有日期、存 UTC 零点、
//     `timezone` 为 null，`composeEventData` 也一并处理了。
//
// 内容全部经过 `eventContentSchema`（发布接口用的同一份 zod schema）再落库，
// 所以演示数据跟真实契约不会漂移 —— 少一个必填、时区写错、封面 URL 不合法，
// seed 当场报错，而不是在页面上默默渲染成空白。

/** `DEMO_EVENTS.author` / `.attendees` 里的这个值代表「发起人（真人账号）」。 */
const OWNER = '__owner__';

interface DemoSpeaker {
  name: string;
  title: string;
  org: string;
  /** `scripts/demo/assets/` 里的头像文件名；'' 表示走 Avatar 的首字母兜底。 */
  avatar?: string;
  link?: string;
  bio: string;
}

interface DemoEventSpec {
  /** 删除边界。必须出现在 `DEMO_EVENT_IDS` 里（seed 启动时断言）。 */
  id: string;
  /** 演示同事的 handle，或 `OWNER`。 */
  author: string;
  title: string;
  summary: string;
  descriptionMd: string;
  kind: 'external' | 'internal' | 'expert_talk' | 'seminar';
  topics: string[];
  mode: 'online' | 'offline' | 'hybrid';
  /** 相对今天的天数（负数＝过去），按活动自己的时区算挂钟日期。 */
  startDay: number;
  /** 'HH:mm'，全天活动留空。 */
  startTime?: string;
  endDay?: number;
  endTime?: string;
  allDay?: boolean;
  /** 全天活动忽略（`composeEventData` 会把 timezone 置空）。 */
  tz: EventTimezoneValue;
  venue?: string;
  city?: EventCityValue;
  meetingUrl?: string;
  websiteUrl?: string;
  /** `scripts/demo/assets/` 里的封面文件名。 */
  cover?: string;
  /** CSS object-position；不给就是「详情页完整显示」那一支。 */
  coverPos?: string;
  pinned?: boolean;
  /** 取消于相对今天的第 N 天（活动仍然可见，带「已取消」徽章）。 */
  cancelledDay?: number;
  speakers?: DemoSpeaker[];
  /** 演示同事 handle 或 `OWNER`；`attendeeCount` 按这个长度写。 */
  attendees: string[];
}

const DEMO_NOTE = '> 演示条目：本页内容是社区功能演示用的样例，不是真实的活动安排。';

const md = (...lines: string[]): string => [DEMO_NOTE, '', ...lines].join('\n');

const DEMO_EVENTS: readonly DemoEventSpec[] = [
  // ── 往期 ────────────────────────────────────────────────────────────────
  {
    id: 'demo-evt-past-summit',
    author: 'demo-lifang',
    title: '异构推理系统技术大会 2026',
    summary: '三日技术大会：内核、调度、显存三条主线，线下 Montreal + 线上同步。',
    descriptionMd: md(
      '面向推理系统方向的三日大会，主会场在 Montreal，同步开放线上会场。',
      '今年的主线是「把一次推理拆开计时」：从内核、调度到显存，每一层都要能单独讲清楚代价。',
      '',
      '## 议程',
      '',
      '| 日期 | 上午 | 下午 |',
      '| --- | --- | --- |',
      '| 第 1 天 | 主旨报告 · 推理系统的成本曲线 | 内核与算子专题 |',
      '| 第 2 天 | 调度与批处理专题 | 海报环节 + 圆桌 |',
      '| 第 3 天 | 量化与显存专题 | 闭门研讨（需报名） |',
      '',
      '## 参加方式',
      '',
      '- **线下**：Montreal 会场，名额有限，走官网报名；',
      '- **线上**：主会场全程直播，分会场只放录像。',
      '',
      '## 想投海报的话',
      '',
      '1. 先在版块里贴一版摘要，让同方向的人先看一眼；',
      '2. 闭门研讨只收带数据的议题 —— 只有观点的留到圆桌。',
    ),
    kind: 'external',
    topics: ['infra', 'llm', 'research'],
    mode: 'hybrid',
    startDay: -92,
    startTime: '09:00',
    endDay: -90,
    endTime: '18:00',
    tz: 'America/Toronto',
    venue: 'Montreal 会场 · 示例会议中心',
    city: 'Montreal',
    meetingUrl: 'https://meeting.example.com/j/inference-summit',
    websiteUrl: 'https://example.com/events/inference-summit',
    cover: 'event-cover-conf-montreal.jpg',
    speakers: [
      {
        name: '方澜',
        title: '主旨报告',
        org: '示例大学 计算系统实验室',
        avatar: 'speaker-d.jpg',
        link: 'https://example.com/people/fanglan',
        bio: '研究方向是推理系统的成本模型与调度。（演示内容，非真实人物）',
      },
      {
        name: 'M. Okafor',
        title: '专题主持',
        org: '示例研究院 系统组',
        bio: '负责第 2 天调度与批处理专题的组织与串场。（演示内容，非真实人物）',
      },
      {
        name: '苏黎',
        title: '闭门研讨召集人',
        org: '示例研究院 系统组',
        bio: '召集第 3 天的闭门研讨，只收带数据的议题。（演示内容，非真实人物）',
      },
    ],
    attendees: ['demo-lifang', 'demo-chentuo', 'demo-huangjing', 'demo-wangsen', 'demo-zhouke'],
  },
  {
    id: 'demo-evt-past-memory-talk',
    author: 'demo-chentuo',
    title: '专家分享：长上下文推理的显存账本',
    summary: '长上下文推理的显存都花在哪儿，三种省法各自的代价是什么。',
    descriptionMd: md(
      '一次线上分享：长上下文场景下显存到底花在哪儿，以及常见的三种省法各自换来了什么。',
      '',
      '## 提纲',
      '',
      '- **KV Cache 的实际占用**：为什么按公式估出来的总是偏小；',
      '- **分页与换出**：省下的显存换来了多少额外延迟；',
      '- **量化 KV**：精度损失具体出现在哪一段。',
      '',
      '分享 90 分钟，最后 20 分钟答疑。回放之后会贴到版块的「论文精读」栏目里。',
    ),
    kind: 'expert_talk',
    topics: ['llm', 'infra'],
    mode: 'online',
    startDay: -45,
    startTime: '10:00',
    endTime: '11:30',
    tz: 'Asia/Shanghai',
    city: 'China',
    meetingUrl: 'https://meeting.example.com/j/memory-talk',
    speakers: [
      {
        name: '郑屿',
        title: '资深工程师',
        org: '示例科技 推理平台组',
        avatar: 'speaker-e.jpg',
        link: 'https://example.com/people/zhengyu',
        bio: '长期做长上下文推理的显存优化。（演示内容，非真实人物）',
      },
    ],
    attendees: ['demo-lifang', 'demo-chentuo', 'demo-huangjing', 'demo-wangsen'],
  },
  {
    id: 'demo-evt-past-data-seminar',
    author: 'demo-huangjing',
    title: '数据流水线双周研讨（第 6 期）',
    summary: '双周数据流水线研讨：这一期聊评测集的采样、去重与归档。',
    descriptionMd: md(
      '双周一次的数据流水线研讨，这一期讲评测集本身怎么造。',
      '',
      '## 这一期的三个议题',
      '',
      '1. **采样**：线上分布怎么取，取多久才算够；',
      '2. **去重**：近似重复对指标的影响到底有多大；',
      '3. **归档**：一份评测集怎么才能半年后还跑得起来。',
      '',
      '不做汇报，带着自己的数据来对齐口径即可。',
    ),
    kind: 'seminar',
    topics: ['data', 'algorithms'],
    mode: 'offline',
    startDay: -21,
    startTime: '14:00',
    endTime: '16:00',
    tz: 'America/Toronto',
    venue: 'Waterloo 办公区 3 楼 讨论室 A',
    city: 'Waterloo',
    speakers: [
      {
        name: '黄婧',
        title: '评测方法与回归基线',
        org: '温哥华研究所 · 系统评测团队',
        bio: '本社区成员，这一期负责串场。（演示内容）',
      },
    ],
    attendees: ['demo-huangjing', 'demo-wangsen', 'demo-zhouke'],
  },
  {
    id: 'demo-evt-past-toolchain-cancelled',
    author: 'demo-wangsen',
    title: '工具链月度同步会（8 月）',
    summary: '工具链方向的月度同步会 —— 本次已取消，议题顺延到下一期。',
    descriptionMd: md(
      '工具链方向的月度同步会。**本次已取消**：与季度评审撞了时间，议题整体顺延到下一期。',
      '',
      '## 原定议题',
      '',
      '- 编译选项对融合内核生成的影响；',
      '- 产物版本与跑分口径的绑定；',
      '- 下一版打包格式的迁移窗口。',
      '',
      '已经加入的同学不用做什么，下一期开放报名时会另发通知。',
    ),
    kind: 'internal',
    topics: ['infra', 'other'],
    mode: 'offline',
    startDay: -12,
    startTime: '13:00',
    endTime: '14:30',
    tz: 'America/Edmonton',
    venue: 'Edmonton 办公区 2 楼 会议室 B',
    city: 'Edmonton',
    cancelledDay: -14,
    attendees: ['demo-chentuo', 'demo-wangsen'],
  },
  {
    id: 'demo-evt-past-render-workshop',
    author: 'demo-zhouke',
    title: '移动端渲染性能工作坊',
    summary: '半天动手工作坊：把一帧拆成五个阶段，各自在自己的场景上跑一遍。',
    descriptionMd: md(
      '半天的动手工作坊：用抓帧工具把一帧拆成五个阶段，然后各自在自己的场景上跑一遍。',
      '',
      '## 安排',
      '',
      '| 时间 | 内容 |',
      '| --- | --- |',
      '| 10:00 | 帧预算与逐阶段计时（讲） |',
      '| 10:40 | 抓帧实操：把自己的场景拆开 |',
      '| 11:30 | 结果对照与答疑 |',
      '',
      '## 需要自带',
      '',
      '- 一台能跑目标机型的设备；',
      '- 一个能稳定复现的场景 —— 最好是「感觉卡但说不清哪儿卡」的那种。',
    ),
    kind: 'seminar',
    topics: ['graphics', 'algorithms'],
    mode: 'hybrid',
    startDay: -7,
    startTime: '10:00',
    endTime: '12:00',
    tz: 'America/Vancouver',
    venue: 'Vancouver 办公区 5 楼 实验区',
    city: 'Vancouver',
    meetingUrl: 'https://meeting.example.com/j/render-workshop',
    cover: 'event-cover-workshop-vancouver.jpg',
    speakers: [
      {
        name: '周珂',
        title: '移动端渲染管线',
        org: '温哥华研究所 · 图形渲染团队',
        avatar: 'speaker-b.jpg',
        bio: '本社区成员，做移动端渲染管线与帧预算。（演示内容）',
      },
    ],
    attendees: ['demo-zhouke', 'demo-huangjing', 'demo-lifang', 'demo-chentuo'],
  },
  {
    id: 'demo-evt-past-paper-lunch',
    author: 'demo-lifang',
    title: '午间论文速读：稀疏注意力三篇',
    summary: '午间 60 分钟，三个人各讲一篇稀疏注意力的论文。',
    descriptionMd: md(
      '午间 60 分钟，三个人各讲一篇，每人 15 分钟，剩下的时间随便问。',
      '',
      '本期三篇分别讲块稀疏、滑动窗口，以及「稀疏在长上下文下什么时候反而不划算」。',
      '',
      '自带午饭，不点名，不做记录 —— 这是个读论文的场子，不是评审会。',
    ),
    kind: 'internal',
    topics: ['research', 'llm'],
    mode: 'offline',
    startDay: -3,
    startTime: '12:00',
    endTime: '13:00',
    tz: 'America/Toronto',
    venue: 'Toronto 办公区 2 楼 咖啡角',
    city: 'Toronto',
    attendees: ['demo-lifang', 'demo-zhouke', OWNER],
  },

  // ── 正在进行 / 本周 ─────────────────────────────────────────────────────
  {
    id: 'demo-evt-live-agent-hack',
    author: 'demo-chentuo',
    title: '社区 Agent 共创马拉松',
    summary: '两天共创：围绕社区已有的工具，做一个真能跑起来的 Agent 小工具。',
    descriptionMd: md(
      '两天的共创马拉松：围绕社区里已经有的工具，做一个真的能跑起来的 Agent 小工具。',
      '',
      '## 节奏',
      '',
      '- **第 1 天** 09:00 组队与选题，18:00 前交一版能跑的骨架；',
      '- **第 2 天** 全天开发，17:00 开始演示，每组 5 分钟。',
      '',
      '## 评什么',
      '',
      '1. 真的跑起来了 —— 这一条比「想法完整」重要；',
      '2. 能被别人接着用（README 与依赖说清楚）；',
      '3. 解决的是自己团队真实遇到的麻烦。',
      '',
      '场地两天全天开放，没组队的同学直接来现场。',
    ),
    kind: 'internal',
    topics: ['agents', 'infra'],
    mode: 'offline',
    startDay: -1,
    startTime: '09:00',
    endDay: 1,
    endTime: '18:00',
    tz: 'America/Vancouver',
    venue: 'Vancouver 办公区 1 楼 开放区',
    city: 'Vancouver',
    cover: 'event-cover-hack-vancouver.jpg',
    coverPos: '50% 30%',
    attendees: ['demo-lifang', 'demo-chentuo', 'demo-zhouke', 'demo-huangjing', 'demo-wangsen'],
  },
  {
    id: 'demo-evt-today-eval-talk',
    author: 'demo-huangjing',
    title: '专家分享：多模态检索的评测口径',
    summary: '同一个模型换一套评测集就差十几个点 —— 这次把差在哪儿讲清楚。',
    descriptionMd: md(
      '同一个模型，换一套评测集就能差出十几个点。这次不谈模型，只谈评测口径本身。',
      '',
      '## 提纲',
      '',
      '- 检索评测的三种常见口径，以及它们各自默认了什么；',
      '- 负样本怎么取，取错了会把结论带到哪儿；',
      '- 一份可复现的评测清单。',
      '',
      '线上进行，**会议链接登录后可见**；点了「我要参加」的同学，开始前 30 分钟会收到提醒。',
    ),
    kind: 'expert_talk',
    topics: ['multimodal', 'research'],
    mode: 'online',
    startDay: 0,
    startTime: '16:00',
    endTime: '17:30',
    tz: 'America/Toronto',
    meetingUrl: 'https://meeting.example.com/j/eval-talk',
    speakers: [
      {
        name: '何岸',
        title: '研究员',
        org: '示例研究院 多模态中心',
        avatar: 'speaker-a.jpg',
        link: 'https://example.com/people/hean',
        bio: '研究多模态检索与评测方法。（演示内容，非真实人物）',
      },
    ],
    attendees: [
      'demo-lifang',
      'demo-chentuo',
      'demo-zhouke',
      'demo-huangjing',
      'demo-wangsen',
      OWNER,
    ],
  },
  {
    id: 'demo-evt-week-algo-seminar',
    author: 'demo-lifang',
    title: '算法与数据工程双周研讨',
    summary: '算法 × 数据工程联合研讨，本期聊特征回填与采样偏差。',
    descriptionMd: md(
      '双周一次的算法 × 数据工程联合研讨，线下在 Ottawa，线上同步。',
      '',
      '## 本期议题',
      '',
      '1. **特征回填的一致性**：训练与线上取数不一致，怎么定位；',
      '2. **采样偏差**：小流量实验的结论什么时候能外推；',
      '3. 自由讨论。',
      '',
      '每个议题 30 分钟：讲 15 分钟、问 15 分钟。想加议题的同学在评论区报名。',
    ),
    kind: 'seminar',
    topics: ['algorithms', 'data'],
    mode: 'hybrid',
    startDay: 3,
    startTime: '15:00',
    endTime: '17:00',
    tz: 'America/Toronto',
    venue: 'Ottawa 办公区 4 楼 报告厅',
    city: 'Ottawa',
    meetingUrl: 'https://meeting.example.com/j/algo-data',
    cover: 'event-cover-seminar-ottawa.jpg',
    speakers: [
      {
        name: '李芳',
        title: '推理内核与量化',
        org: '温哥华研究所 · 推理加速团队',
        bio: '本社区成员，本期负责串场。（演示内容）',
      },
    ],
    attendees: ['demo-huangjing', 'demo-lifang', 'demo-wangsen'],
  },

  // ── 未来 ────────────────────────────────────────────────────────────────
  {
    id: 'demo-evt-embodied-talk',
    author: 'demo-chentuo',
    title: '专家分享：具身智能的仿真到真机',
    summary: '仿真训好的策略搬到真机为什么掉链子，以及几种缩小差距的做法。',
    descriptionMd: md(
      '一次线上分享：仿真里训好的策略，搬到真机上为什么会掉链子，以及目前几种缩小差距的做法。',
      '',
      '## 提纲',
      '',
      '- **差距从哪儿来**：动力学、感知、时延三笔账；',
      '- **域随机化的收益边界**：什么时候加了也没用；',
      '- **真机数据要采多少才够**。',
      '',
      '90 分钟，含答疑。',
    ),
    kind: 'expert_talk',
    topics: ['embodied', 'multimodal'],
    mode: 'online',
    startDay: 6,
    startTime: '09:30',
    endTime: '11:00',
    tz: 'Asia/Shanghai',
    city: 'China',
    meetingUrl: 'https://meeting.example.com/j/embodied-talk',
    speakers: [
      {
        name: '许南',
        title: '主任研究员',
        org: '示例研究院 具身智能中心',
        link: 'https://example.com/people/xunan',
        bio: '做仿真到真机的迁移与真机数据采集。（演示内容，非真实人物）',
      },
    ],
    attendees: ['demo-lifang', 'demo-huangjing'],
  },
  {
    id: 'demo-evt-open-day',
    author: 'demo-wangsen',
    title: '实验室开放日',
    summary: '实验室开放日，全天开放、随到随看，三个方向都有演示台。',
    descriptionMd: md(
      '实验室开放日，全天开放，不设固定议程，随到随看。',
      '',
      '## 当天有什么',
      '',
      '- 三个方向的演示台：推理加速 / 图形渲染 / 数据工程；',
      '- 常驻答疑：各团队都会留人在场；',
      '- 下午两场 20 分钟小讲，现场排队。',
      '',
      '**全天活动**，来去自由；带同事、带家属都可以。',
    ),
    kind: 'internal',
    topics: ['other', 'data'],
    mode: 'offline',
    startDay: 10,
    allDay: true,
    tz: 'America/Toronto',
    venue: 'Waterloo 办公区（全楼开放）',
    city: 'Waterloo',
    cover: 'event-cover-openday-waterloo.jpg',
    attendees: ['demo-zhouke', 'demo-huangjing', 'demo-wangsen', 'demo-chentuo'],
  },
  {
    id: 'demo-evt-tech-week',
    author: OWNER,
    title: 'AI 社区技术周',
    summary: '三天八个专题的社区技术周，线上线下同时开，按天挑场次。',
    descriptionMd: md(
      '社区技术周：三天、八个专题，线上线下同时开。**全天活动**，按天挑自己感兴趣的场次即可。',
      '',
      '## 三天的主线',
      '',
      '| 日期 | 主线 | 形式 |',
      '| --- | --- | --- |',
      '| 第 1 天 | 大模型与推理系统 | 报告 + 圆桌 |',
      '| 第 2 天 | Agent 与工具链 | 报告 + 动手场 |',
      '| 第 3 天 | 前沿研究速览 | 短报告（每场 15 分钟） |',
      '',
      '## 报名',
      '',
      '- 线下场次请在官网登记，方便安排场地；',
      '- 线上场次直接用会议链接进（**登录后可见**）。',
      '',
      '## 想讲一场',
      '',
      '投稿窗口在开始前两周关闭。摘要一页就够，不要求完整论文 —— 讲清楚「你解决了什么、代价是什么」即可。',
    ),
    kind: 'external',
    topics: ['llm', 'agents', 'research'],
    mode: 'hybrid',
    startDay: 24,
    endDay: 26,
    allDay: true,
    tz: 'America/Toronto',
    venue: 'Toronto 会场 · 示例会展中心',
    city: 'Toronto',
    meetingUrl: 'https://meeting.example.com/j/tech-week',
    websiteUrl: 'https://example.com/events/community-tech-week',
    cover: 'event-cover-summit-toronto.jpg',
    coverPos: '50% 65%',
    pinned: true,
    speakers: [
      {
        name: '林蔚',
        title: '开场报告',
        org: '示例大学 智能系统学院',
        avatar: 'speaker-c.jpg',
        link: 'https://example.com/people/linwei',
        bio: '第 1 天开场，讲大模型与推理系统这一年的变化。（演示内容，非真实人物）',
      },
      {
        name: 'L. Duarte',
        title: '动手场主持',
        org: '示例科技 开发者关系',
        bio: '第 2 天动手场的主持与答疑。（演示内容，非真实人物）',
      },
    ],
    attendees: ['demo-lifang', 'demo-chentuo', 'demo-zhouke', 'demo-huangjing', OWNER],
  },
  {
    id: 'demo-evt-scheduler-seminar',
    author: 'demo-chentuo',
    title: '算力调度专题研讨',
    summary: '半天研讨：集群调度与单机批处理调度，坑长得像但不是一回事。',
    descriptionMd: md(
      '半天研讨：集群层面的调度，跟单机上的批处理调度是两回事，但踩的坑经常长得一样。',
      '',
      '## 议题',
      '',
      '1. **排队与抢占**：谁该被打断，被打断之后重算还是换出；',
      '2. **碎片化**：显存碎片与卡数碎片是两笔账；',
      '3. **一份能对齐的调度评测口径**。',
      '',
      '带自己的数据来最好，没有数据也可以来听。',
    ),
    kind: 'seminar',
    topics: ['infra', 'algorithms'],
    mode: 'offline',
    startDay: 17,
    startTime: '13:30',
    endTime: '16:30',
    tz: 'America/Edmonton',
    venue: 'Edmonton 办公区 3 楼 研讨室',
    city: 'Edmonton',
    speakers: [
      {
        name: '陈拓',
        title: '调度与批处理',
        org: '温哥华研究所 · 推理加速团队',
        bio: '本社区成员，做调度与批处理。（演示内容）',
      },
    ],
    attendees: ['demo-chentuo', 'demo-wangsen'],
  },
  {
    id: 'demo-evt-render-review',
    author: 'demo-zhouke',
    title: '渲染管线季度评审',
    summary: '季度评审：过去一个季度渲染管线上的改动，逐条过收益与代价。',
    descriptionMd: md(
      '季度评审：把过去一个季度渲染管线上的改动逐条过一遍。',
      '',
      '## 流程',
      '',
      '- 每个改动 10 分钟：动了哪一层、基线是什么、代价落在哪；',
      '- 最后 30 分钟定下个季度的三件事。',
      '',
      '线上线下同时开，线上的同学请提前测一下麦。',
    ),
    kind: 'internal',
    topics: ['graphics'],
    mode: 'hybrid',
    startDay: 31,
    startTime: '14:00',
    endTime: '15:30',
    tz: 'America/Vancouver',
    venue: 'Vancouver 办公区 5 楼 会议室 C',
    city: 'Vancouver',
    meetingUrl: 'https://meeting.example.com/j/render-review',
    attendees: ['demo-zhouke', 'demo-huangjing', 'demo-lifang'],
  },
  {
    id: 'demo-evt-graphics-forum',
    author: 'demo-zhouke',
    title: '图形与并行计算前沿论坛',
    summary: '三日论坛：渲染、仿真，以及它们共用的那套并行原语。',
    descriptionMd: md(
      '三日论坛，主题是图形与并行计算的交叉地带：渲染、仿真，以及它们共用的那套并行原语。',
      '',
      '## 主线',
      '',
      '- **第 1 天**：实时渲染的工程实践；',
      '- **第 2 天**：并行原语与调度；',
      '- **第 3 天**：仿真与可微渲染。',
      '',
      '## 投稿与报名',
      '',
      '摘要投稿走官网，长文与海报都收。名额有限，报名按提交顺序排。',
      '',
      '离现在还早，先放出来是为了让想投稿的同学有时间准备。',
    ),
    kind: 'external',
    topics: ['graphics', 'research'],
    mode: 'offline',
    startDay: 75,
    startTime: '09:00',
    endDay: 77,
    endTime: '17:00',
    tz: 'America/Toronto',
    venue: 'Montreal 会场 · 示例大学 主楼',
    city: 'Montreal',
    websiteUrl: 'https://example.com/events/graphics-forum',
    cover: 'event-cover-forum-montreal.jpg',
    coverPos: '50% 40%',
    pinned: true,
    speakers: [
      {
        name: '陆迢',
        title: '论坛主席',
        org: '示例大学 图形与并行计算实验室',
        avatar: 'speaker-f.jpg',
        link: 'https://example.com/people/lutiao',
        bio: '论坛主席，负责议程与投稿评审。（演示内容，非真实人物）',
      },
      {
        name: 'K. Aliyev',
        title: '第 2 天主持',
        org: '示例研究院 并行计算组',
        bio: '主持并行原语与调度专题。（演示内容，非真实人物）',
      },
    ],
    attendees: ['demo-zhouke', 'demo-lifang', 'demo-chentuo'],
  },
];

async function buildEvents(uid: Uid, ownerId: string): Promise<void> {
  const { prisma } = await import('@/lib/db');
  const { composeEventData, eventContentSchema } = await import('@/lib/events/validate');
  const { addDaysUtc, dayKey, nowWall, toWallDate } = await import('@/lib/events/time');

  /** 相对今天第 `offset` 天，在 `zone` 的挂钟日期。全天活动传 null（用运行机的挂钟）。 */
  const dayIn = (offset: number, zone: string | null): string =>
    dayKey(addDaysUtc(zone ? toWallDate(new Date(), zone) : nowWall(), offset));

  const userId = (who: string): string => (who === OWNER ? ownerId : uid(who));

  // 同一张图只拷一次：讲师头像被两个活动引用时，两行存的是同一个 key，
  // unseed 的候选集是 Set，删一次即可。
  const assetUrls = new Map<string, string>();
  const assetUrl = async (file: string | undefined): Promise<string> => {
    if (!file) return '';
    let url = assetUrls.get(file);
    if (!url) {
      url = await putUploadAsset(file);
      assetUrls.set(file, url);
    }
    return url;
  };

  let speakerRows = 0;
  let attendeeRows = 0;

  for (const [i, spec] of DEMO_EVENTS.entries()) {
    const zone = spec.allDay ? null : spec.tz;
    const speakers = spec.speakers ?? [];

    // 发布接口用的同一份 zod schema —— 少一个必填 / 时区写错 / 封面 URL 不合法，
    // 这里就当场抛，而不是在页面上默默渲染成空白。
    const input = eventContentSchema.parse({
      title: spec.title,
      summary: spec.summary,
      descriptionMd: spec.descriptionMd,
      kind: spec.kind,
      topics: spec.topics,
      mode: spec.mode,
      startDate: dayIn(spec.startDay, zone),
      startTime: spec.startTime ?? '',
      endDate: spec.endDay === undefined ? '' : dayIn(spec.endDay, zone),
      endTime: spec.endTime ?? '',
      allDay: spec.allDay ?? false,
      timezone: spec.tz,
      venue: spec.venue ?? '',
      city: spec.city ?? '',
      meetingUrl: spec.meetingUrl ?? '',
      websiteUrl: spec.websiteUrl ?? '',
      coverUrl: await assetUrl(spec.cover),
      coverPos: spec.cover ? (spec.coverPos ?? '') : '',
      speakers: await Promise.all(
        speakers.map(async (s) => ({
          name: s.name,
          title: s.title,
          org: s.org,
          avatarUrl: await assetUrl(s.avatar),
          link: s.link ?? '',
          bio: s.bio,
        })),
      ),
    });
    // 定时活动的 UTC 瞬时在这里算出来（内部走 zonedWallToUtc，DST 感知）。
    const composed = composeEventData(input);
    if (!composed.ok) throw new Error(`演示活动 ${spec.id} 的时间不合法：${composed.reason}`);

    // 「发布时间」：开始前三周，但不能晚于现在（远期活动就是「最近才发出来的」）。
    const announced = new Date(
      Math.min(composed.value.columns.startAt.getTime() - 21 * DAY, Date.now() - (2 + (i % 9) * 3) * DAY),
    );

    await prisma.event.create({
      data: {
        // 写死 id —— 这就是 unseed 的删除边界（见文件开头）。
        id: spec.id,
        authorId: userId(spec.author),
        ...composed.value.columns,
        // pinned / cancelledAt 不在内容 schema 里（它们走管理与取消两条独立路由），
        // 所以直接写列，跟那两条路由写的是同一个字段。
        // cancelledDay 与 startDay 同一套符号（负数＝过去），daysAgo 收的是
        // 「几天前」，所以要取反。
        pinned: spec.pinned ?? false,
        cancelledAt: spec.cancelledDay === undefined ? null : daysAgo(-spec.cancelledDay, 11, 0),
        createdAt: announced,
        speakers: { create: composed.value.speakers },
      },
      select: { id: true },
    });
    speakerRows += speakers.length;

    // 参加记录 + 计数：照抄 attend 路由的守卫式事务形状（那里没有 lib 入口）。
    // remindedAt 一律先占上：开始前 30 分钟的提醒会**发邮件**，演示不该往真人
    // 信箱塞东西。想演示提醒，把这些行的 remindedAt 清成 null 即可。
    // 去重后再算计数：createMany 会 skipDuplicates，但 attendeeCount 是自己写的，
    // 表里手滑写重一个 handle 就会让计数比真实行数多 —— 那正是这一列最怕的漂移。
    const rows = [...new Set(spec.attendees.map(userId))].map((id) => ({
      eventId: spec.id,
      userId: id,
      remindedAt: announced,
    }));
    await prisma.$transaction([
      prisma.eventAttendee.createMany({ data: rows, skipDuplicates: true }),
      prisma.event.update({ where: { id: spec.id }, data: { attendeeCount: rows.length } }),
    ]);
    attendeeRows += rows.length;
  }

  log(
    `✓ 活动 ${DEMO_EVENTS.length} 个（讲师 ${speakerRows} 位、参加记录 ${attendeeRows} 条、` +
      `封面与头像 ${assetUrls.size} 张）`,
  );
}

// ─── 长文案 ─────────────────────────────────────────────────────────────────

const ZONE_A_ABOUT = [
  '本版块记录 **推理侧的性能工作**：内核、量化、调度、显存，以及把它们放在一起之后互相打架的地方。',
  '',
  '### 这里适合发什么',
  '',
  '- 一次实验的完整记录 —— 包括结论是「没测出差别」的那种；',
  '- 成体系的评测报告，附上能跑起来的脚本与原始数据；',
  '- 读完一篇论文之后，「它解决了什么、代价是什么」的笔记。',
  '',
  '### 三条约定',
  '',
  '1. **先说口径，再说数字。** 没有口径的数字没法比，也没法复现。',
  '2. **构造数据要标出来。** 演示、示意、举例都行，别让读者以为是实测。',
  '3. **附件跟正文放一起。** 报告、表格、胶片直接挂在帖子里，右侧面板能直接读。',
  '',
  '版规见右栏；实验口径统一在 Wiki 的《实验规范》。',
].join('\n');

const ZONE_B_ABOUT = [
  '本版块围绕 **图形与渲染** 的工程实践：管线各阶段的剖析、帧预算、抓帧与掉帧分布。',
  '',
  '### 这里适合发什么',
  '',
  '- 一次抓帧的完整剖析，最好带上「改之前 / 改之后」两组数；',
  '- 管线阶段的改动记录，说明它动了哪一层、代价落在哪里；',
  '- 图形与并行计算方向的论文笔记。',
  '',
  '### 约定',
  '',
  '- 谈性能先给基线，机型与系统版本写进正文；',
  '- 均值不够，掉帧分布才是用户能感觉到的东西；',
  '- 加入需要审核 —— 不是为了拦人，是为了知道谁在看。',
].join('\n');

const RULES_MD = [
  '这一页是本版块的版规，右栏的手风琴按标题逐条展开。',
  '',
  '## 先说口径，再说数字',
  '',
  '任何性能数字都要能回答三个问题：在什么硬件上、用什么输入、怎么统计的。',
  '没有这三样，数字既不能比也不能复现，讨论会退化成互相报数。',
  '',
  '## 构造数据必须标出来',
  '',
  '示意、演示、举例都可以发，但要在显眼位置写清楚这不是实测。',
  '被别人当成实测结论引用出去，比不发还糟。',
  '',
  '## 结论可以是「还不确定」',
  '',
  '实验记录不需要有结论。没测出差别、被噪声淹了、方法有问题 —— 都值得写下来，',
  '省得下一个人再踩一遍。',
  '',
  '## 附件跟正文放在一起',
  '',
  '报告、原始数据、胶片直接挂在帖子上，用正文里的引用卡片指过去，读者不用下载就能看。',
  '不要只贴一个网盘链接。',
  '',
  '## 对事不对人',
  '',
  '评审别人的实验时说清楚你质疑的是哪一步。「这个数不对」不是评审，',
  '「你的 P99 是不是没算排队」才是。',
].join('\n');

const RULES_MD_GRAPHICS = [
  '这一页是本版块的版规。',
  '',
  '## 谈性能先给基线',
  '',
  '机型、系统版本、分辨率、是否锁频，写进正文。少一样，两次跑分就不可比。',
  '',
  '## 均值不够',
  '',
  '掉帧是分布问题不是均值问题。给出分位数，或者干脆贴帧时间曲线。',
  '',
  '## 抓帧要可复现',
  '',
  '说明场景怎么进、相机停在哪、采样窗口多长。别人复现不了的抓帧只能当逸事。',
].join('\n');

const PROTOCOL_MD = [
  '本版块所有性能实验共用的口径。改这一页之前先在帖子里讨论。',
  '',
  '## 预热与重复',
  '',
  '- 每组配置跑 5 轮，**丢掉第一轮**（预热、JIT、缓存都在第一轮里）；',
  '- 取中位数作为代表值，另报 P99；',
  '- 均值不作为对外数字 —— 它会被长尾拖着走。',
  '',
  '## 延迟口径',
  '',
  '- 对外的 P50 / P99 一律是**端到端**，含排队；',
  '- 只算解码的那版内部叫「纯算」，可以在正文里提，但不进结论表。',
  '',
  '## 输入分布',
  '',
  '- 默认输入 1024 token、输出 128 token；',
  '- 涉及调度的实验必须用长短混合的输入，等长输入会让调度策略之间看不出差别。',
  '',
  '## 记录什么',
  '',
  '| 必填 | 说明 |',
  '| --- | --- |',
  '| 硬件 | 型号、数量、互联方式 |',
  '| 软件 | 框架与内核版本、编译选项 |',
  '| 输入 | 长度分布、到达过程 |',
  '| 统计 | 轮数、是否丢首轮、分位数定义 |',
  '',
  '## 什么时候另开一篇',
  '',
  '一篇实验记录只讲一个变量。改了两处就分两篇，否则结论没法归因。',
].join('\n');

// ═══════════════════════════════════════════════════════════════════════════

main().catch((e) => {
  console.error('\n✗ 失败：', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
