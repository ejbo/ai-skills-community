// One-off: generate AI summaries for videos that don't have one yet (e.g. the
// demo seed, or videos created before summaries were generated on upload).
// Run: pnpm exec tsx scripts/backfill-video-summaries.ts
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function main() {
  // Dynamic imports so env is populated before @/lib/env validates it.
  const { prisma } = await import('@/lib/db');
  const { generateVideoSummary } = await import('@/lib/video/summary');

  const videos = await prisma.video.findMany({
    where: { deletedAt: null, aiSummaryMd: null },
    select: { id: true, slug: true },
  });
  console.log(`Backfilling AI summaries for ${videos.length} video(s)…`);

  let ok = 0;
  for (const v of videos) {
    try {
      const res = await generateVideoSummary(v.id, 'zh-CN');
      if (res) {
        ok++;
        console.log(`  ✓ ${v.slug}`);
      } else {
        console.log(`  – ${v.slug} (no transcript/description to summarize)`);
      }
    } catch (e) {
      console.log(`  ✗ ${v.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }
  console.log(`Done — generated ${ok}/${videos.length}.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
