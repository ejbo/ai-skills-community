import Link from 'next/link';
import { prisma } from '@/lib/db';
import { SourceBadge } from '@/components/SourceBadge';

interface CoInstallRow {
  skillId: string;
  slug: string;
  name: string;
  summary: string;
  sourceType: 'internal' | 'external' | 'curated';
  coCount: bigint;
}

export async function CompositionTab({ skillId }: { skillId: string }) {
  // Find users who subscribed/downloaded this skill, then count the other skills
  // they engaged with. Subscribe is a stronger signal than download — weight 3 vs 1.
  const rows = await prisma.$queryRaw<CoInstallRow[]>`
    WITH peers AS (
      SELECT DISTINCT "userId" FROM "Subscription" WHERE "skillId" = ${skillId}
      UNION
      SELECT DISTINCT "userId" FROM "Favorite" WHERE "skillId" = ${skillId}
    )
    SELECT
      s.id AS "skillId",
      s.slug,
      s.name,
      s.summary,
      s."sourceType"::text AS "sourceType",
      COUNT(*) AS "coCount"
    FROM peers p
    JOIN "Subscription" sub ON sub."userId" = p."userId" AND sub."skillId" != ${skillId}
    JOIN "Skill" s ON s.id = sub."skillId"
    WHERE s.status = 'published' AND s."deletedAt" IS NULL
    GROUP BY s.id, s.slug, s.name, s.summary, s."sourceType"
    ORDER BY "coCount" DESC
    LIMIT 6
  `;

  if (rows.length === 0) {
    return (
      <div className="surface rounded-2xl px-6 py-10 text-center">
        <p className="text-sm text-muted">这个 Skill 还没有足够的共同安装数据。</p>
      </div>
    );
  }

  const maxCount = Number(rows[0].coCount);
  const stackUrl = `/skills?install=${rows.map((r) => r.slug).join(',')}`;

  return (
    <div className="space-y-4">
      <div className="surface rounded-2xl p-4">
        <h3 className="text-sm font-semibold">经常被一起安装</h3>
        <p className="mt-1 text-xs text-muted">
          下面这些 Skill 经常和当前 Skill 出现在同一用户的本地。
        </p>
        <ul className="mt-4 space-y-2">
          {rows.map((r) => {
            const pct = (Number(r.coCount) / maxCount) * 100;
            return (
              <li key={r.skillId} className="group relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
                <div
                  className="absolute inset-y-0 left-0 bg-accent-500/10 transition-all group-hover:bg-accent-500/15"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <Link
                  href={`/skills/${r.slug}`}
                  className="relative flex items-center justify-between gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium group-hover:text-accent-600">{r.name}</span>
                      <SourceBadge source={r.sourceType} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">{r.summary}</p>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {Number(r.coCount)} 人共同安装
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-accent-500/30 bg-accent-500/5 p-3 text-xs">
          <span>
            一键打包安装这个 Stack（{rows.length} 个 Skill）
          </span>
          <code className="rounded bg-white px-2 py-1 font-mono dark:bg-zinc-900">
            skills install {rows.map((r) => r.slug).join(' ')}
          </code>
        </div>
      </div>
    </div>
  );
}
