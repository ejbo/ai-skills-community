// One-off (idempotent): give every titled item a title-based URL — links say
// what they point at instead of a hash (docs/contracts/slugs.md).
//
//  - 活动 / 讨论话题 / 意见反馈 / 公告 / 技术专区帖子 / 投票活动: rows whose `slug` is
//    still null get their title slug. Nothing is retired — their old links used the
//    id, and the id keeps resolving.
//  - 知识库 `doc-<nanoid>`, 视频 `v-<nanoid>`, Wiki `page-<nanoid>`: the hash slug is
//    REPLACED by the title slug and the old one goes to SlugAlias, so every link
//    already shared redirects to the new address.
//
// Oldest rows first, so the earliest of two same-titled items keeps the bare slug.
// Run after `pnpm prisma migrate deploy`:
//   pnpm slugs:backfill --dry   # print `old → new`, write nothing
//   pnpm slugs:backfill
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function main() {
  const dry = process.argv.includes('--dry');
  // Dynamic imports so env is populated before @/lib/env validates it.
  const titleSlugs = await import('@/lib/title-slugs');
  const { backfillVideoSlugs } = await import('@/lib/video/slug');
  const { backfillWikiSlugs } = await import('@/lib/zones/wiki-queries');
  const { backfillLibraryDocSlugs } = await import('@/lib/library/slug');
  const { backfillVoteSlugs } = await import('@/lib/votes/slug');
  const { prisma } = await import('@/lib/db');

  const steps: [string, () => Promise<{ updated: number }>][] = [
    ['活动 events', () => titleSlugs.backfillEventSlugs({ dry })],
    ['讨论话题 topics', () => titleSlugs.backfillTopicSlugs({ dry })],
    ['意见反馈 feedback', () => titleSlugs.backfillFeedbackSlugs({ dry })],
    ['公告 announcements', () => titleSlugs.backfillAnnouncementSlugs({ dry })],
    ['技术专区帖子 zone posts', () => titleSlugs.backfillZonePostSlugs({ dry })],
    ['投票活动 votes', () => backfillVoteSlugs({ dry })],
    ['知识库 library docs', () => backfillLibraryDocSlugs({ dry })],
    ['视频 videos', () => backfillVideoSlugs({ dry })],
    ['Wiki pages', () => backfillWikiSlugs({ dry })],
  ];

  console.log(dry ? 'Dry run — nothing is written.\n' : 'Backfilling title slugs…\n');
  const summary: [string, number][] = [];
  try {
    for (const [label, run] of steps) {
      const { updated } = await run();
      summary.push([label, updated]);
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log(`\n${dry ? 'Would update' : 'Updated'}:`);
  for (const [label, n] of summary) console.log(`  ${label.padEnd(24)} ${n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
