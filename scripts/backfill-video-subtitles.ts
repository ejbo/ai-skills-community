// One-off: generate 中/EN subtitles (and, from them, the AI transcript + a refreshed
// summary) for long videos published BEFORE subtitles reached the long-video board.
//
//   pnpm videos:backfill-subtitles              # dry run: list what would be processed
//   pnpm videos:backfill-subtitles --apply      # run the pipeline, one video at a time
//   pnpm videos:backfill-subtitles --apply --limit 5
//
// Only rows with a LOCAL source file (videoKey) and no tracks yet (status none /
// failed) are touched; tracks someone uploaded by hand are never regenerated.
// Each run is the real pipeline (lib/video/subtitles.ts): whisper at near real
// time on the capped thread pool, so an hour-long talk is roughly an hour. It is
// safe to stop (Ctrl-C) and re-run — finished videos are skipped, and a job the
// stop orphaned is reset by the pipeline's own stale sweep.
//
// Run it on the box that has whisper + ffmpeg. While it runs it competes with the
// app's own queue only through the DB claim (each process has its own FIFO), so
// prefer a quiet hour.
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function main() {
  const apply = process.argv.includes('--apply');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? Math.max(1, Number.parseInt(process.argv[limitArg + 1] ?? '', 10) || 0) : undefined;

  // Dynamic imports so env is populated before @/lib/env validates it.
  const { prisma } = await import('@/lib/db');
  const { generateVideoSubtitles, subtitlesAvailable } = await import('@/lib/video/subtitles');

  const videos = await prisma.video.findMany({
    where: {
      isShort: false,
      deletedAt: null,
      status: 'published',
      videoKey: { not: null },
      subtitleManual: false,
      subtitleStatus: { in: ['none', 'failed'] },
    },
    orderBy: { publishedAt: 'desc' },
    select: { id: true, slug: true, durationSec: true },
    ...(limit ? { take: limit } : {}),
  });
  const minutes = Math.round(videos.reduce((n, v) => n + v.durationSec, 0) / 60);
  console.log(`${videos.length} long video(s) without subtitles — about ${minutes} min of speech in total.`);
  for (const v of videos) console.log(`  · ${v.slug} (${Math.round(v.durationSec / 60)} min)`);

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to generate.');
  } else if (!(await subtitlesAvailable())) {
    console.log('\nwhisper is not installed on this machine (whisper-cli / openai-whisper) — nothing generated.');
  } else {
    let ok = 0;
    for (const v of videos) {
      const t0 = Date.now();
      await generateVideoSubtitles(v.id); // settles when the job reaches a terminal state; never throws
      const row = await prisma.video.findUnique({ where: { id: v.id }, select: { subtitleStatus: true, subtitleError: true } });
      const took = Math.round((Date.now() - t0) / 1000);
      if (row?.subtitleStatus === 'ready') {
        ok++;
        console.log(`  ✓ ${v.slug} (${took}s)${row.subtitleError ? ` — ${row.subtitleError}` : ''}`);
      } else {
        console.log(`  ✗ ${v.slug} (${took}s): ${row?.subtitleError ?? row?.subtitleStatus ?? 'unknown'}`);
      }
    }
    console.log(`Done — ${ok}/${videos.length} ready. Summaries refresh in the background as transcripts land.`);
    // The summary refresh is detached; give the last one a moment before the pool closes.
    await new Promise((r) => setTimeout(r, 3000));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
