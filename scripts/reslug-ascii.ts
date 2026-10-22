// One-off (idempotent): move every slug that still contains non-ASCII (中文标题的链接) to its
// pinyin / ASCII form (lib/slug-ascii.ts), retiring the old slug into SlugAlias so every link
// already shared keeps resolving (docs/contracts/slugs.md, 2026-10-21 owner decision 「一起变了」).
//
// Covers every titled kind: 活动 / 讨论话题 / 意见反馈 / 公告 / 技术专区帖子 / 投票活动 / 知识库 / 视频 / Wiki / 报告.
// Oldest rows first so the earliest of two same-titled items keeps the bare slug. Run after deploying
// the build that switched freeTitleSlug to asciiTitleSlug:
//   pnpm slugs:ascii --dry   # print `old → new`, write nothing
//   pnpm slugs:ascii
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

// eslint-disable-next-line no-control-regex
const NON_ASCII = /[^\x00-\x7f]/;

interface Step<R extends { id: string; slug: string | null; title: string }> {
  label: string;
  kind: 'event' | 'topic' | 'feedback' | 'announcement' | 'zone_post' | 'vote' | 'library_doc' | 'video' | 'wiki_page' | 'report';
  rows: () => Promise<R[]>;
  scope?: (row: R) => string;
  pick: (row: R) => Promise<string>;
  write: (tx: import('@prisma/client').Prisma.TransactionClient, row: R, slug: string) => Promise<unknown>;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const { prisma } = await import('@/lib/db');
  const { retireSlug } = await import('@/lib/slug-server');
  const titleSlugs = await import('@/lib/title-slugs');
  const { freeVoteSlug } = await import('@/lib/votes/slug');
  const { uniqueDocSlug } = await import('@/lib/library/slug');
  const { uniqueVideoSlug } = await import('@/lib/video/slug');
  const { uniqueWikiSlugForTitle } = await import('@/lib/zones/wiki-queries');
  const { pickReportSlug } = await import('@/lib/zones/reports/queries');

  const steps: Step<{ id: string; slug: string | null; title: string; zoneId?: string }>[] = [
    {
      label: '活动 events',
      kind: 'event',
      rows: () => prisma.event.findMany({ where: { slug: { not: null } }, select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => titleSlugs.pickEventSlug(r.title),
      write: (tx, r, slug) => tx.event.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '讨论话题 topics',
      kind: 'topic',
      rows: () => prisma.discussionTopic.findMany({ where: { slug: { not: null } }, select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => titleSlugs.pickTopicSlug(r.title),
      write: (tx, r, slug) => tx.discussionTopic.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '意见反馈 feedback',
      kind: 'feedback',
      rows: () => prisma.feedback.findMany({ where: { slug: { not: null } }, select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => titleSlugs.pickFeedbackSlug(r.title),
      write: (tx, r, slug) => tx.feedback.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '公告 announcements',
      kind: 'announcement',
      rows: () => prisma.announcement.findMany({ where: { slug: { not: null } }, select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => titleSlugs.pickAnnouncementSlug(r.title, prisma, r.id),
      write: (tx, r, slug) => tx.announcement.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '技术专区帖子 zone posts',
      kind: 'zone_post',
      rows: () => prisma.zonePost.findMany({ where: { slug: { not: null } }, select: { id: true, slug: true, title: true, zoneId: true }, orderBy: { createdAt: 'asc' } }),
      scope: (r) => r.zoneId!,
      pick: (r) => titleSlugs.pickZonePostSlug(r.zoneId!, r.title, prisma, r.id),
      write: (tx, r, slug) => tx.zonePost.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '投票活动 votes',
      kind: 'vote',
      rows: () => prisma.voteActivity.findMany({ where: { slug: { not: null } }, select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => freeVoteSlug(r.title, { selfId: r.id }),
      write: (tx, r, slug) => tx.voteActivity.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '知识库 library docs',
      kind: 'library_doc',
      rows: () => prisma.libraryDoc.findMany({ where: { deletedAt: null }, select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => uniqueDocSlug(r.title),
      write: (tx, r, slug) => tx.libraryDoc.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '视频 videos',
      kind: 'video',
      rows: () => prisma.video.findMany({ select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => uniqueVideoSlug(r.title, undefined, r.id),
      write: (tx, r, slug) => tx.video.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: 'Wiki pages',
      kind: 'wiki_page',
      rows: () => prisma.zoneWikiPage.findMany({ where: { deletedAt: null }, select: { id: true, slug: true, title: true, zoneId: true }, orderBy: { createdAt: 'asc' } }),
      scope: (r) => r.zoneId!,
      pick: (r) => uniqueWikiSlugForTitle(r.zoneId!, r.title, r.id),
      write: (tx, r, slug) => tx.zoneWikiPage.update({ where: { id: r.id }, data: { slug } }),
    },
    {
      label: '报告 reports',
      kind: 'report',
      rows: () => prisma.zoneReport.findMany({ where: { slug: { not: null } }, select: { id: true, slug: true, title: true }, orderBy: { createdAt: 'asc' } }),
      pick: (r) => pickReportSlug(r.title, r.id),
      write: (tx, r, slug) => tx.zoneReport.update({ where: { id: r.id }, data: { slug } }),
    },
  ];

  console.log(dry ? 'Dry run — nothing is written.\n' : 'Moving non-ASCII slugs to pinyin…\n');
  const summary: [string, number][] = [];
  try {
    for (const step of steps) {
      let n = 0;
      for (const row of await step.rows()) {
        if (!row.slug || !NON_ASCII.test(row.slug)) continue;
        const next = await step.pick(row);
        if (!next || next === row.slug) continue;
        console.log(`[${step.kind}] ${step.scope ? `${step.scope(row)}/` : ''}${row.slug} → ${next}`);
        n++;
        if (dry) continue;
        const scope = step.scope ? step.scope(row) : '';
        await prisma.$transaction(async (tx) => {
          await step.write(tx, row, next);
          await retireSlug(step.kind, row.slug!, row.id, scope, tx);
        });
      }
      summary.push([step.label, n]);
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(`\n${dry ? 'Would move' : 'Moved'}:`);
  for (const [label, n] of summary) console.log(`  ${label.padEnd(24)} ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
