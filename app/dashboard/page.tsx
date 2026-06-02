import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Plus, Sparkles, Bell, Star, Inbox } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SkillCard } from '@/components/SkillCard';
import { SourceBadge } from '@/components/SourceBadge';
import { VisibilityBadge } from '@/components/VisibilityBadge';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/auth/login?callbackUrl=/dashboard');

  const userId = session.user.id;

  const [owned, subscribed, favorited] = await Promise.all([
    prisma.skill.findMany({
      where: { authorId: userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      include: {
        currentVersion: { select: { version: true } },
      },
    }),
    prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        skill: {
          include: {
            author: { select: { handle: true, displayName: true } },
            currentVersion: { select: { version: true } },
          },
        },
        installedVersion: { select: { version: true } },
      },
    }),
    prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 12,
      include: {
        skill: {
          include: { author: { select: { handle: true, displayName: true } } },
        },
      },
    }),
  ]);

  const subscribedWithUpdates = subscribed.filter(
    (s) =>
      s.skill.currentVersionId &&
      s.installedVersionId &&
      s.installedVersionId !== s.skill.currentVersionId,
  );

  // Pending download-access requests across the user's own skills.
  const pendingGroups = await prisma.skillAccessRequest.groupBy({
    by: ['skillId'],
    where: { status: 'pending', skillId: { in: owned.map((s) => s.id) } },
    _count: { _all: true },
  });
  const pendingMap = new Map(pendingGroups.map((p) => [p.skillId, p._count._all]));
  const totalPending = pendingGroups.reduce((sum, p) => sum + p._count._all, 0);

  return (
    <div className="container py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">我的面板</h1>
          <p className="mt-1 text-sm text-muted">
            欢迎回来，{session.user.displayName}
          </p>
        </div>
        <Link
          href="/skills/new"
          className="flex h-9 items-center gap-1.5 rounded-lg bg-accent-500 px-4 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          <Plus className="h-3.5 w-3.5" />
          发布新 Skill
        </Link>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatBox icon={<Sparkles className="h-4 w-4" />} label="我发布的" value={owned.length} />
        <StatBox icon={<Bell className="h-4 w-4" />} label="我订阅的" value={subscribed.length} extra={subscribedWithUpdates.length > 0 ? `${subscribedWithUpdates.length} 个有新版本` : undefined} />
        <StatBox icon={<Star className="h-4 w-4" />} label="我收藏的" value={favorited.length} />
        <StatBox icon={<Inbox className="h-4 w-4" />} label="待处理申请" value={totalPending} extra={totalPending > 0 ? '点击下方 Skill 处理' : undefined} />
      </div>

      <section className="mt-10">
        <SectionHeader title="我发布的 Skills" count={owned.length} />
        {owned.length === 0 ? (
          <Empty hint="你还没发布过 Skill。" action={{ href: '/skills/new', label: '马上发一个 →' }} />
        ) : (
          <ul className="surface mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800">
            {owned.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link href={`/skills/${s.slug}`} className="truncate font-medium hover:text-accent-600">
                      {s.name}
                    </Link>
                    <SourceBadge source={s.sourceType} />
                    <VisibilityBadge visibility={s.visibility} />
                    <StatusBadge status={s.status} />
                    {s.currentVersion && (
                      <span className="font-mono text-[11px] text-muted">v{s.currentVersion.version}</span>
                    )}
                    {(pendingMap.get(s.id) ?? 0) > 0 && (
                      <Link
                        href={`/skills/${s.slug}?tab=manage`}
                        className="rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger transition hover:bg-danger/25"
                      >
                        {pendingMap.get(s.id)} 个下载申请待处理
                      </Link>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">{s.summary}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="font-mono tabular-nums">⬇ {s.downloadCount}</span>
                  <span className="font-mono tabular-nums">❤ {s.likeCount}</span>
                  <span className="text-[11px]">
                    {formatDistanceToNowStrict(s.updatedAt, { addSuffix: true })}
                  </span>
                  <Link
                    href={`/skills/${s.slug}/edit`}
                    className="rounded border border-zinc-200 px-2 py-0.5 text-[11px] transition hover:border-accent-500 hover:text-accent-600 dark:border-zinc-700"
                  >
                    编辑
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionHeader
          title="我订阅的 Skills"
          count={subscribed.length}
          extra={
            subscribedWithUpdates.length > 0 ? (
              <span className="rounded-full bg-warn/15 px-2 py-0.5 text-xs font-medium text-warn">
                {subscribedWithUpdates.length} 个有更新可用
              </span>
            ) : null
          }
        />
        {subscribed.length === 0 ? (
          <Empty hint="还没有订阅任何 Skill。" action={{ href: '/skills', label: '去浏览 →' }} />
        ) : (
          <ul className="surface mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl dark:divide-zinc-800">
            {subscribed.map((s) => {
              const hasUpdate =
                s.skill.currentVersionId &&
                s.installedVersionId &&
                s.installedVersionId !== s.skill.currentVersionId;
              return (
                <li key={s.skillId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/skills/${s.skill.slug}`} className="truncate font-medium hover:text-accent-600">
                        {s.skill.name}
                      </Link>
                      <SourceBadge source={s.skill.sourceType} />
                      {hasUpdate && (
                        <span className="rounded-full bg-warn/15 px-2 py-0.5 text-[10px] font-medium text-warn">
                          有更新
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      作者 {s.skill.author.displayName} · 你装的 v{s.installedVersion?.version ?? '?'} · 最新 v{s.skill.currentVersion?.version ?? '?'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <SectionHeader title="我收藏的 Skills" count={favorited.length} />
        {favorited.length === 0 ? (
          <Empty hint="还没有收藏任何 Skill。" action={{ href: '/skills', label: '去浏览 →' }} />
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {favorited.map((f) => (
              <SkillCard
                key={f.skillId}
                slug={f.skill.slug}
                name={f.skill.name}
                summary={f.skill.summary}
                sourceType={f.skill.sourceType}
                author={f.skill.author}
                updatedAt={f.skill.updatedAt}
                stats={{
                  downloads: f.skill.downloadCount,
                  likes: f.skill.likeCount,
                  rating: f.skill.avgRating,
                  reviewCount: f.skill.reviewCount,
                  tokens: f.skill.tokenCostEstimate,
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatBox({
  icon,
  label,
  value,
  extra,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  extra?: string;
}) {
  return (
    <div className="surface rounded-xl p-4">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">{value}</div>
      {extra && <div className="mt-1 text-xs text-warn">{extra}</div>}
    </div>
  );
}

function SectionHeader({
  title,
  count,
  extra,
}: {
  title: string;
  count: number;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <span className="text-sm text-muted">{count}</span>
      {extra}
    </div>
  );
}

function Empty({
  hint,
  action,
}: {
  hint: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="surface mt-3 rounded-2xl px-6 py-10 text-center">
      <p className="text-sm text-muted">{hint}</p>
      {action && (
        <Link href={action.href} className="mt-3 inline-block text-sm text-accent-600 hover:text-accent-700">
          {action.label}
        </Link>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'draft' | 'published' | 'archived' }) {
  const styles =
    status === 'published'
      ? { bg: '#dcfce7', color: '#166534', label: '已发布' }
      : status === 'draft'
        ? { bg: '#fef3c7', color: '#92400e', label: '草稿' }
        : { bg: '#fee2e2', color: '#991b1b', label: '已归档' };
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{ background: styles.bg, color: styles.color }}
    >
      {styles.label}
    </span>
  );
}
