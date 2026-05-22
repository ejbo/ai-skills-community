import { prisma } from '@/lib/db';

const W_DOWNLOADS = 0.4;
const W_LIKES = 0.3;
const W_REVIEWS = 0.2;
const W_RECENCY = 0.1;

interface AggRow {
  skillId: string;
  downloads7d: bigint;
  likes7d: bigint;
  reviews7d: bigint;
  ageDays: number;
}

export async function refreshTrending(): Promise<{ updated: number; tookMs: number }> {
  const started = Date.now();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await prisma.$queryRaw<AggRow[]>`
    SELECT
      s.id AS "skillId",
      COALESCE((SELECT COUNT(*) FROM "Download" d WHERE d."skillId" = s.id AND d."createdAt" >= ${since}), 0)::bigint AS "downloads7d",
      COALESCE((SELECT COUNT(*) FROM "Like" l WHERE l."skillId" = s.id AND l."createdAt" >= ${since}), 0)::bigint AS "likes7d",
      COALESCE((SELECT COUNT(*) FROM "Review" r WHERE r."skillId" = s.id AND r."createdAt" >= ${since}), 0)::bigint AS "reviews7d",
      EXTRACT(EPOCH FROM (now() - s."createdAt"))::float / 86400 AS "ageDays"
    FROM "Skill" s
    WHERE s."deletedAt" IS NULL AND s.status = 'published'
  `;

  let updated = 0;
  for (const r of rows) {
    const score =
      Number(r.downloads7d) * W_DOWNLOADS +
      Number(r.likes7d) * W_LIKES +
      Number(r.reviews7d) * W_REVIEWS +
      (1 / (1 + r.ageDays)) * 100 * W_RECENCY;
    await prisma.skill.update({
      where: { id: r.skillId },
      data: { trendingScore: score },
    });
    updated += 1;
  }

  return { updated, tookMs: Date.now() - started };
}
