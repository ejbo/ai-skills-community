import { getLocale, getTranslations } from 'next-intl/server';
import { Clock, Users, Download, BarChart3 } from 'lucide-react';
import { auth } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { relativeTime } from '@/lib/i18n-date';
import {
  getSkillAccessOverview,
  getSkillAnalytics,
  getSkillDownloaders,
} from '@/lib/skill-analytics';
import { DecisionButtons } from './DecisionButtons';

type AccessOverview = Awaited<ReturnType<typeof getSkillAccessOverview>>;
type Analytics = Awaited<ReturnType<typeof getSkillAnalytics>>;
type Downloaders = Awaited<ReturnType<typeof getSkillDownloaders>>;

type Identity = {
  id: string;
  handle: string;
  displayName: string;
  email: string;
  huaweiW3Id: string | null;
  avatarUrl: string | null;
  isPrivate: boolean;
};

async function Who({ user, viewerCanSeeIdentity }: { user: Identity | null; viewerCanSeeIdentity: boolean }) {
  const t = await getTranslations('skill_manage');
  if (!user) return <span className="text-muted">{t('anonymous')}</span>;
  // 隐私账号：没有「查看完整身份」权限的查看者（技能作者也是普通成员）只显示昵称——
  // @handle 对 SSO 用户就是工号，email/W3 更是名单级信息。
  if (user.isPrivate && !viewerCanSeeIdentity) {
    const tp = await getTranslations('profile');
    return (
      <div className="min-w-0">
        <div className="truncate font-medium">{user.displayName}</div>
        <div className="truncate text-[11px] text-muted">{tp('private_badge')}</div>
      </div>
    );
  }
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

/** Pending download requests + active grants. Presentational; data passed in. */
export async function AccessSection({
  overview,
  slug,
  viewerCanSeeIdentity,
}: {
  overview: AccessOverview;
  slug: string;
  viewerCanSeeIdentity: boolean;
}) {
  const t = await getTranslations('skill_manage');
  const tdash = await getTranslations('dashboard');
  const locale = await getLocale();
  return (
    <div className="space-y-5">
      <Section icon={<Clock className="h-4 w-4 text-warn" />} title={tdash('stat_pending')} count={overview.pending.length}>
        {overview.pending.length === 0 ? (
          <p className="text-sm text-muted">{t('access_pending_empty')}</p>
        ) : (
          <ul className="space-y-3">
            {overview.pending.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="min-w-0 flex-1">
                  <Who user={r.user} viewerCanSeeIdentity={viewerCanSeeIdentity} />
                  {r.message && <p className="mt-1 text-xs text-muted">「{r.message}」</p>}
                  <p className="mt-1 text-[11px] text-muted">{relativeTime(r.createdAt, locale)}</p>
                </div>
                <DecisionButtons slug={slug} id={r.id} variant="pending" />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section icon={<Users className="h-4 w-4 text-ok" />} title={t('access_granted')} count={overview.approved.length}>
        {overview.approved.length === 0 ? (
          <p className="text-sm text-muted">{t('access_granted_empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] uppercase text-muted dark:border-zinc-800">
                  <th className="py-2 pr-3 font-medium">{t('col_user')}</th>
                  <th className="py-2 pr-3 font-medium">{t('col_granted_at')}</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {overview.approved.map((g) => (
                  <tr key={g.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2 pr-3">
                      <Who user={g.user} viewerCanSeeIdentity={viewerCanSeeIdentity} />
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">
                      {g.decidedAt ? relativeTime(g.decidedAt, locale) : '—'}
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
    </div>
  );
}

/** Download log + aggregate analytics. Presentational; data passed in. */
export async function AnalyticsSection({
  analytics,
  downloaders,
  viewerCanSeeIdentity,
}: {
  analytics: Analytics;
  downloaders: Downloaders;
  viewerCanSeeIdentity: boolean;
}) {
  const t = await getTranslations('skill_manage');
  const td = await getTranslations('detail');
  const locale = await getLocale();
  return (
    <div className="space-y-5">
      <Section icon={<Download className="h-4 w-4" />} title={t('downloads_log')} count={analytics.totals.downloads}>
        {downloaders.length === 0 ? (
          <p className="text-sm text-muted">{t('downloads_empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] uppercase text-muted dark:border-zinc-800">
                  <th className="py-2 pr-3 font-medium">{t('col_downloader')}</th>
                  <th className="py-2 pr-3 font-medium">{t('col_version')}</th>
                  <th className="py-2 pr-3 font-medium">{t('col_client')}</th>
                  <th className="py-2 font-medium">{t('col_time')}</th>
                </tr>
              </thead>
              <tbody>
                {downloaders.map((d) => (
                  <tr key={d.id} className="border-b border-zinc-100 dark:border-zinc-800/60">
                    <td className="py-2 pr-3">
                      <Who user={d.user} viewerCanSeeIdentity={viewerCanSeeIdentity} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{d.version ? `v${d.version}` : '—'}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] dark:bg-zinc-800">
                        {d.client}
                        {d.via && d.via !== d.client ? `·${d.via}` : ''}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-muted">{relativeTime(d.createdAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {analytics.totals.downloads > downloaders.length && (
              <p className="mt-2 text-[11px] text-muted">{t('showing_recent', { count: downloaders.length })}</p>
            )}
          </div>
        )}
      </Section>

      <Section icon={<BarChart3 className="h-4 w-4" />} title={t('analytics')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('stat_total_downloads')} value={analytics.totals.downloads.toLocaleString()} />
          <Stat label={t('stat_unique_users')} value={analytics.totals.uniqueDownloaders.toLocaleString()} />
          <Stat label={t('stat_web_cli')} value={`${analytics.clientSplit.web} / ${analytics.clientSplit.cli}`} />
          <Stat label={t('stat_try_runs')} value={analytics.totals.tryRuns.toLocaleString()} />
          <Stat label={t('favorites')} value={analytics.totals.favorites.toLocaleString()} />
          <Stat label={t('likes')} value={analytics.totals.likes.toLocaleString()} />
          <Stat label={t('subscribers')} value={analytics.totals.subscribers.toLocaleString()} />
          <Stat
            label={t('rating')}
            value={analytics.totals.avgRating > 0 ? analytics.totals.avgRating.toFixed(1) : '—'}
          />
        </div>
        <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">{t('per_version_downloads')}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-[11px] uppercase text-muted dark:border-zinc-800">
                <th className="py-2 pr-3 font-medium">{t('col_version')}</th>
                <th className="py-2 pr-3 font-medium">{td('downloads')}</th>
                <th className="py-2 pr-3 font-medium">{t('status')}</th>
                <th className="py-2 font-medium">{t('col_size')}</th>
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

/** Combined access + analytics view (legacy single-tab composition). */
export async function ManageTab({ skillId, slug }: { skillId: string; slug: string }) {
  const [session, overview, analytics, downloaders] = await Promise.all([
    auth(),
    getSkillAccessOverview(skillId),
    getSkillAnalytics(skillId),
    getSkillDownloaders(skillId, 100),
  ]);
  const viewerCanSeeIdentity = can(session?.user, 'identity');
  return (
    <div className="space-y-5">
      <AccessSection overview={overview} slug={slug} viewerCanSeeIdentity={viewerCanSeeIdentity} />
      <AnalyticsSection analytics={analytics} downloaders={downloaders} viewerCanSeeIdentity={viewerCanSeeIdentity} />
    </div>
  );
}
