import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { prisma } from '@/lib/db';
import { VisibilityBadge } from '@/components/VisibilityBadge';
import {
  getSkillAnalytics,
  getSkillDownloaders,
  getSkillAccessOverview,
} from '@/lib/skill-analytics';
import { SkillStatusActions } from '../SkillStatusActions';
import { DecisionButtons } from '@/app/skills/[slug]/DecisionButtons';

export const dynamic = 'force-dynamic';

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
    <span>
      <span className="font-medium">{user.displayName}</span>
      <span className="ml-1 text-[10px] text-muted">
        @{user.handle} · {user.email}
        {user.huaweiW3Id ? ` · W3:${user.huaweiW3Id}` : ''}
      </span>
    </span>
  );
}

export default async function AdminSkillDetailPage({ params }: { params: { slug: string } }) {
  const skill = await prisma.skill.findUnique({
    where: { slug: params.slug },
    include: {
      author: { select: { handle: true, displayName: true, email: true } },
      currentVersion: { select: { version: true } },
    },
  });
  if (!skill) notFound();

  const [analytics, downloaders, access] = await Promise.all([
    getSkillAnalytics(skill.id),
    getSkillDownloaders(skill.id, 200),
    getSkillAccessOverview(skill.id),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-xs text-muted">
        <Link href="/manage/skills" className="hover:text-accent-600">
          ← Skill 审核
        </Link>
      </div>

      <div className="surface flex flex-wrap items-start justify-between gap-3 rounded-xl p-4">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/skills/${skill.slug}`} className="text-xl font-semibold hover:text-accent-600">
              {skill.name}
            </Link>
            <VisibilityBadge visibility={skill.visibility} showPublic />
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-muted">{skill.slug}</div>
          <div className="mt-1 text-xs text-muted">
            作者{' '}
            <Link href={`/users/${skill.author.handle}`} className="hover:text-accent-600">
              {skill.author.displayName}
            </Link>{' '}
            · {skill.author.email} · 当前 v{skill.currentVersion?.version ?? '—'}
          </div>
        </div>
        <SkillStatusActions
          slug={skill.slug}
          status={skill.status}
          sourceType={skill.sourceType}
          visibility={skill.visibility}
        />
      </div>

      {/* Analytics */}
      <section className="surface rounded-xl p-4">
        <h3 className="mb-3 text-sm font-semibold">数据分析</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="总下载" value={analytics.totals.downloads} />
          <Stat label="独立用户" value={analytics.totals.uniqueDownloaders} />
          <Stat label="网页 / CLI" value={`${analytics.clientSplit.web} / ${analytics.clientSplit.cli}`} />
          <Stat label="Try 次数" value={analytics.totals.tryRuns} />
          <Stat label="收藏" value={analytics.totals.favorites} />
          <Stat label="点赞" value={analytics.totals.likes} />
          <Stat label="订阅" value={analytics.totals.subscribers} />
          <Stat label="评分" value={analytics.totals.avgRating > 0 ? analytics.totals.avgRating.toFixed(1) : '—'} />
        </div>
        <h4 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted">各版本下载</h4>
        <table className="data">
          <thead>
            <tr>
              <th>版本</th>
              <th>下载</th>
              <th>状态</th>
              <th>大小</th>
              <th>发布</th>
            </tr>
          </thead>
          <tbody>
            {analytics.perVersion.map((v) => (
              <tr key={v.id}>
                <td className="font-mono text-[11px]">v{v.version}</td>
                <td className="font-mono tabular-nums">{v.downloads}</td>
                <td className="text-[11px]">{v.status}</td>
                <td className="font-mono text-[11px] text-muted">{(v.totalBytes / 1024).toFixed(1)} KB</td>
                <td className="font-mono text-[11px] text-muted">
                  {v.publishedAt ? format(v.publishedAt, 'yyyy-MM-dd') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Pending requests + grants */}
      <section className="surface rounded-xl p-4">
        <h3 className="mb-3 text-sm font-semibold">
          访问申请 / 授权
          {access.pending.length > 0 && (
            <span className="ml-2 rounded-full bg-danger/15 px-1.5 text-[11px] text-danger">
              {access.pending.length} 待处理
            </span>
          )}
        </h3>
        {access.pending.length === 0 && access.approved.length === 0 && access.past.length === 0 ? (
          <p className="text-xs text-muted">暂无访问申请。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>申请人</th>
                <th>状态</th>
                <th>理由 / 备注</th>
                <th>时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {[...access.pending, ...access.approved, ...access.past].map((r) => (
                <tr key={r.id}>
                  <td>
                    <Who user={r.user} />
                  </td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td className="text-[11px] text-muted">{r.message || r.decisionNote || '—'}</td>
                  <td className="font-mono text-[10px] text-muted">
                    {format(r.decidedAt ?? r.createdAt, 'MM-dd HH:mm')}
                  </td>
                  <td>
                    {r.status === 'pending' ? (
                      <DecisionButtons slug={skill.slug} id={r.id} variant="pending" />
                    ) : r.status === 'approved' ? (
                      <DecisionButtons slug={skill.slug} id={r.id} variant="grant" />
                    ) : (
                      <span className="text-[10px] text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Downloaders */}
      <section className="surface rounded-xl p-4">
        <h3 className="mb-3 text-sm font-semibold">下载记录（最近 {downloaders.length} 条）</h3>
        {downloaders.length === 0 ? (
          <p className="text-xs text-muted">还没有下载记录。</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>下载者</th>
                <th>版本</th>
                <th>客户端</th>
                <th>来源</th>
                <th>IP Hash</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {downloaders.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Who user={d.user} />
                  </td>
                  <td className="font-mono text-[11px]">{d.version ? `v${d.version}` : '—'}</td>
                  <td className="text-[11px]">{d.client}</td>
                  <td className="text-[11px] text-muted">{d.via ?? '—'}</td>
                  <td className="font-mono text-[10px] text-muted">{d.ipHash ?? '—'}</td>
                  <td className="font-mono text-[10px] text-muted">{format(d.createdAt, 'MM-dd HH:mm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-lg tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
