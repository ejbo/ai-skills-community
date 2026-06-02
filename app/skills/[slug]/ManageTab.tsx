import { formatDistanceToNowStrict } from 'date-fns';
import { Clock, Users, Download, BarChart3 } from 'lucide-react';
import {
  getSkillAccessOverview,
  getSkillAnalytics,
  getSkillDownloaders,
} from '@/lib/skill-analytics';
import { DecisionButtons } from './DecisionButtons';

type Identity = {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  huaweiW3Id: string | null;
  avatarUrl: string | null;
};

function Who({ user }: { user: Identity | null }) {
  if (!user) return <span className="text-muted">匿名</span>;
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{user.displayName}</div>
      <div className="truncate text-[11px] text-muted">
        @{user.handle} · {user.email}
        {user.huaweiW3Id ? ` · W3:${user.huaweiW3Id}` : ''}
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="surface rounded-2xl p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
        {typeof count === 'number' && (
          <span className="rounded-full bg-zinc-100 px-1.5 text-[11px] font-mono text-muted dark:bg-zinc-800">
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

export async function ManageTab({ skillId, slug }: { skillId: string; slug: string }) {
  const [overview, analytics, downloaders] = await Promise.all([
    getSkillAccessOverview(skillId),
    getSkillAnalytics(skillId),
    getSkillDownloaders(skillId, 100),
  ]);

  return (
    <div className="space-y-5">
      {/* Pending requests */}
      <Section
        icon={<Clock className="h-4 w-4 text-warn" />}
        title="待处理申请"
        count={overview.pending.length}
      >
        {overview.pending.length === 0 ? (
          <p className="text-sm text-muted">暂无待处理的下载申请。</p>
        ) : (
          <ul className="space-y-3">
            {overview.pending.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <Who user={r.user} />
                  {r.message && <p className="mt-1 text-xs text-muted">「{r.message}」</p>}
                  <p className="mt-1 text-[11px] text-muted">
                    {formatDistanceToNowStrict(r.createdAt, { addSuffix: true })}
                  </p>
                </div>
                <DecisionButtons slug={slug} id={r.id} variant="pending" />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Active grants */}
      <Section
        icon={<Users className="h-4 w-4 text-ok" />}
        title="已授权用户"
        count={overview.approved.length}
      >
        {overview.approved.length === 0 ? (
          <p className="text-sm text-muted">还没有授权任何用户。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] uppercase text-muted dark:border-zinc-800">
                  <th className="py-2 pr-3 font-medium">用户</th>
                  <th className="py-2 pr-3 font-medium">授权时间</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {overview.approved.map((g) => (
                  <tr key={g.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2 pr-3">
                      <Who user={g.user} />
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">
                      {g.decidedAt ? formatDistanceToNowStrict(g.decidedAt, { addSuffix: true }) : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <DecisionButtons slug={slug} id={g.id} variant="grant" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Downloaders */}
      <Section
        icon={<Download className="h-4 w-4" />}
        title="下载记录"
        count={analytics.totals.downloads}
      >
        {downloaders.length === 0 ? (
          <p className="text-sm text-muted">还没有下载记录。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] uppercase text-muted dark:border-zinc-800">
                  <th className="py-2 pr-3 font-medium">下载者</th>
                  <th className="py-2 pr-3 font-medium">版本</th>
                  <th className="py-2 pr-3 font-medium">客户端</th>
                  <th className="py-2 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {downloaders.map((d) => (
                  <tr key={d.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2 pr-3">
                      <Who user={d.user} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{d.version ? `v${d.version}` : '—'}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] dark:bg-zinc-800">
                        {d.client}
                        {d.via && d.via !== d.client ? `·${d.via}` : ''}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-muted">
                      {formatDistanceToNowStrict(d.createdAt, { addSuffix: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analytics.totals.downloads > downloaders.length && (
              <p className="mt-2 text-[11px] text-muted">仅显示最近 {downloaders.length} 条。</p>
            )}
          </div>
        )}
      </Section>

      {/* Analytics */}
      <Section icon={<BarChart3 className="h-4 w-4" />} title="数据分析">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="总下载" value={analytics.totals.downloads.toLocaleString()} />
          <Stat label="独立用户" value={analytics.totals.uniqueDownloaders.toLocaleString()} />
          <Stat label="网页 / CLI" value={`${analytics.clientSplit.web} / ${analytics.clientSplit.cli}`} />
          <Stat label="Try 次数" value={analytics.totals.tryRuns.toLocaleString()} />
          <Stat label="收藏" value={analytics.totals.favorites.toLocaleString()} />
          <Stat label="点赞" value={analytics.totals.likes.toLocaleString()} />
          <Stat label="订阅" value={analytics.totals.subscribers.toLocaleString()} />
          <Stat
            label="评分"
            value={analytics.totals.avgRating > 0 ? analytics.totals.avgRating.toFixed(1) : '—'}
          />
        </div>
        <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">
          各版本下载
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase text-muted dark:border-zinc-800">
                <th className="py-2 pr-3 font-medium">版本</th>
                <th className="py-2 pr-3 font-medium">下载</th>
                <th className="py-2 pr-3 font-medium">状态</th>
                <th className="py-2 font-medium">大小</th>
              </tr>
            </thead>
            <tbody>
              {analytics.perVersion.map((v) => (
                <tr key={v.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                  <td className="py-2 pr-3 font-mono text-xs">v{v.version}</td>
                  <td className="py-2 pr-3 font-mono tabular-nums">{v.downloads.toLocaleString()}</td>
                  <td className="py-2 pr-3 text-xs text-muted">{v.status}</td>
                  <td className="py-2 font-mono text-xs text-muted">{(v.totalBytes / 1024).toFixed(1)} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
