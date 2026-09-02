// One-off: generate the card hover-preview clip for 投票作品 videos that were
// uploaded before previews existed (VoteEntry.previewKey is null).
//
// Sequential ON PURPOSE, and note WHY it has to be this script's own doing:
// the shared media-job queue (lib/uploads/job-queue.ts) is per-PROCESS, so it
// bounds this script against ITSELF but not against the running web server —
// nothing here would stop a parallel version from competing with live uploads
// for the same disk PostgreSQL and every media byte lives on. One at a time is
// the throttle. Needs ffmpeg on PATH; entries whose source file is gone, and
// entries of soft-deleted activities, are skipped.
// Run: pnpm votes:backfill-previews
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: '.env.local', override: true });

async function main() {
  // Dynamic imports so env is populated before @/lib/env validates it.
  const { prisma } = await import('@/lib/db');
  const { makeVotePreviewClip, statVoteMediaAsync, deleteVoteMediaFile, voteMediaPublicUrl } =
    await import('@/lib/votes/storage');

  const entries = await prisma.voteEntry.findMany({
    // 软删除活动的作品不生成 —— 前台永远看不到它们，白花 ffmpeg 和磁盘。
    where: { kind: 'video', previewKey: null, activity: { deletedAt: null } },
    select: { id: true, entryNo: true, title: true, fileKey: true, activityId: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`Backfilling hover previews for ${entries.length} vote entry/entries…`);

  let ok = 0;
  let missing = 0;
  let failed = 0;
  let skipped = 0;
  for (const e of entries) {
    const label = `${e.activityId}#${e.entryNo} ${e.title || e.fileKey}`;
    let key: string | null = null;
    try {
      const stat = await statVoteMediaAsync(e.fileKey);
      if (!stat) {
        missing++;
        console.log(`  – ${label}: source file missing on disk, skipped`);
        continue;
      }
      key = await makeVotePreviewClip(e.fileKey, stat.size);
      if (!key) {
        failed++;
        console.log(`  ✗ ${label}: no clip (ffmpeg missing/failed, or source too large)`);
        continue;
      }
      // 只更新「仍然没有 preview」的行：跑这个脚本的同时如果有人重新上传，
      // 或者第二个副本在跑，先落地的那个说了算，我们这一份要连文件一起丢掉，
      // 否则就是一个没人指向的孤儿文件躺在盘上（previewKey 还是 @unique，
      // 直接 update 会以 P2002 收场）。
      const claimed = await prisma.voteEntry.updateMany({
        where: { id: e.id, previewKey: null },
        data: { previewKey: key, previewUrl: voteMediaPublicUrl(key) },
      });
      if (claimed.count === 0) {
        await deleteVoteMediaFile(key).catch(() => undefined);
        key = null;
        skipped++;
        console.log(`  – ${label}: already has a preview (concurrent run?), clip discarded`);
        continue;
      }
      ok++;
      console.log(`  ✓ ${label} → ${key}`);
    } catch (err) {
      failed++;
      // The clip is written before the row points at it — a failed update would
      // otherwise leave it orphaned on the volume.
      await deleteVoteMediaFile(key).catch(() => undefined);
      console.log(`  ✗ ${label}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(
    `Done — ${ok} generated, ${missing} source missing, ${skipped} already claimed, ${failed} failed.`,
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
