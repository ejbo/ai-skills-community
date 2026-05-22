import { Users, Package, Download, Sparkles, Activity } from 'lucide-react';
import { prisma } from '@/lib/db';
import { DashboardCharts } from './DashboardCharts';

export const dynamic = 'force-dynamic';

export default async function AdminDashboard() {
  const since = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [
    userCount,
    skillCount,
    totalDownloads,
    skillsThisWeek,
    activeToday,
    skillsByDay,
    loginsByMethod,
    downloadsByDay,
    reviewsByDay,
    sourceDistribution,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.skill.count({ where: { status: 'published', deletedAt: null } }),
    prisma.skill.aggregate({ _sum: { downloadCount: true } }),
    prisma.skill.count({ where: { createdAt: { gte: since(7) }, deletedAt: null } }),
    prisma.user.count({ where: { lastSeenAt: { gte: since(1) } } }),
    seriesByDay('skills', 30),
    loginsByMethodSeries(30),
    seriesByDay('downloads', 30),
    seriesByDay('reviews', 30),
    prisma.skill.groupBy({
      by: ['sourceType'],
      where: { status: 'published', deletedAt: null },
      _count: true,
    }),
  ]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight">仪表盘</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          icon={<Users className="h-4 w-4" />}
          iconBg="bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300"
          label="总用户"
          value={userCount}
        />
        <StatCard
          icon={<Package className="h-4 w-4" />}
          iconBg="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-300"
          label="Skill 总数"
          value={skillCount}
        />
        <StatCard
          icon={<Download className="h-4 w-4" />}
          iconBg="bg-cyan-100 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300"
          label="累计下载"
          value={totalDownloads._sum.downloadCount ?? 0}
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          iconBg="bg-violet-100 text-violet-600 dark:bg-violet-500/20 dark:text-violet-300"
          label="本周新增"
          value={skillsThisWeek}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          iconBg="bg-rose-100 text-rose-600 dark:bg-rose-500/20 dark:text-rose-300"
          label="今日活跃"
          value={activeToday}
        />
      </div>

      <DashboardCharts
        skillsByDay={skillsByDay}
        loginsByMethod={loginsByMethod}
        downloadsByDay={downloadsByDay}
        reviewsByDay={reviewsByDay}
        sourceDistribution={sourceDistribution.map((r) => ({ type: r.sourceType, count: r._count }))}
      />
    </div>
  );
}

function StatCard({
  icon,
  iconBg,
  label,
  value,
}: {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: number;
}) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${iconBg}`}>{icon}</div>
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

async function seriesByDay(kind: 'skills' | 'downloads' | 'reviews', days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  let rows: Array<{ day: Date; count: bigint }>;
  if (kind === 'skills') {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Skill"
      WHERE "createdAt" >= ${since} AND "deletedAt" IS NULL
      GROUP BY 1 ORDER BY 1
    `;
  } else if (kind === 'downloads') {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Download"
      WHERE "createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1
    `;
  } else {
    rows = await prisma.$queryRaw<typeof rows>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
      FROM "Review"
      WHERE "createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1
    `;
  }
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), count: Number(r.count) }));
}

async function loginsByMethodSeries(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.$queryRaw<Array<{ day: Date; method: string; count: bigint }>>`
    SELECT date_trunc('day', "createdAt") AS day, method::text AS method, COUNT(*)::bigint AS count
    FROM "LoginEvent"
    WHERE "createdAt" >= ${since} AND success = true
    GROUP BY 1, 2 ORDER BY 1
  `;
  return rows.map((r) => ({
    day: r.day.toISOString().slice(0, 10),
    method: r.method as 'password' | 'huawei_sso',
    count: Number(r.count),
  }));
}
