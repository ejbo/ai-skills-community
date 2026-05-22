import { notFound } from 'next/navigation';
import Link from 'next/link';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { prisma } from '@/lib/db';
import { ToggleRow, NumberRow } from './ToggleRow';

export const dynamic = 'force-dynamic';

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      _count: {
        select: {
          skills: true,
          reviews: true,
          subscriptions: true,
          favorites: true,
          likes: true,
          cliTokens: true,
        },
      },
    },
  });
  if (!user) notFound();

  const [logins, visits, skills, adminActions] = await Promise.all([
    prisma.loginEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.pageVisit.findMany({
      where: { userId: user.id },
      orderBy: { visitedAt: 'desc' },
      take: 50,
    }),
    prisma.skill.findMany({
      where: { authorId: user.id, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, slug: true, name: true, status: true, downloadCount: true, updatedAt: true },
    }),
    prisma.adminLog.findMany({
      where: { targetType: 'user', targetId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { adminUser: { select: { displayName: true, handle: true } } },
    }),
  ]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{user.displayName}</h2>
          <p className="text-sm text-muted">
            {user.email} · @{user.handle}
          </p>
        </div>
        <Link href="/manage/users" className="text-xs text-muted hover:text-zinc-900 dark:hover:text-white">
          ← 返回用户列表
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        {/* Main column */}
        <div className="space-y-4">
          <Section title="基础信息">
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <Dt>ID</Dt>
              <Dd className="font-mono text-xs">{user.id}</Dd>
              <Dt>邮箱</Dt>
              <Dd>{user.email}</Dd>
              <Dt>登录方式</Dt>
              <Dd>
                {user.authMethod === 'both' ? '密码 + W3' : user.authMethod === 'huawei_sso' ? 'W3' : '密码'}
                {user.huaweiW3Id && <span className="ml-1 text-xs text-muted">({user.huaweiW3Id})</span>}
              </Dd>
              <Dt>注册时间</Dt>
              <Dd>{format(user.createdAt, 'yyyy-MM-dd HH:mm')}</Dd>
              <Dt>最近登录</Dt>
              <Dd>
                {user.lastLoginAt ? format(user.lastLoginAt, 'yyyy-MM-dd HH:mm') : '—'}
                {user.lastLoginIp && (
                  <span className="ml-1 font-mono text-xs text-muted">{user.lastLoginIp}</span>
                )}
              </Dd>
            </dl>
          </Section>

          <Section title="权限切换（即时保存）">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <ToggleRow userId={user.id} field="isAdmin" label="管理员" current={user.isAdmin} />
              <ToggleRow userId={user.id} field="isActive" label="账号启用" current={user.isActive} />
              <ToggleRow userId={user.id} field="canPublishSkills" label="允许发布 Skill" current={user.canPublishSkills} />
              <ToggleRow userId={user.id} field="canPublishInternal" label="允许发布 internal" current={user.canPublishInternal} />
              <ToggleRow userId={user.id} field="canRemix" label="允许 Remix" current={user.canRemix} />
              <ToggleRow userId={user.id} field="canUseCli" label="允许使用 CLI" current={user.canUseCli} />
              <NumberRow userId={user.id} field="dailyDownloadLimit" label="每日下载上限" current={user.dailyDownloadLimit} />
              <NumberRow userId={user.id} field="dailyPublishLimit" label="每日发布上限" current={user.dailyPublishLimit} />
            </div>
          </Section>

          <Section title={`登录历史 (${logins.length})`}>
            <ScrollList>
              {logins.length === 0 && <Empty>暂无登录记录</Empty>}
              {logins.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="badge"
                      style={{
                        background: l.success ? '#dcfce7' : '#fee2e2',
                        color: l.success ? '#166534' : '#991b1b',
                      }}
                    >
                      {l.success ? '成功' : '失败'}
                    </span>
                    <span>{l.method === 'huawei_sso' ? 'W3' : '密码'}</span>
                    {l.failureReason && <span className="text-muted">— {l.failureReason}</span>}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[11px] text-muted tabular-nums">
                    {l.ip && <span>{l.ip}</span>}
                    <span>{format(l.createdAt, 'MM-dd HH:mm')}</span>
                  </div>
                </li>
              ))}
            </ScrollList>
          </Section>

          <Section title={`页面访问 (${visits.length})`}>
            <ScrollList>
              {visits.length === 0 && <Empty>暂无访问记录</Empty>}
              {visits.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-zinc-800">
                      {v.pageName ?? v.path}
                    </span>
                    <span className="text-muted font-mono text-[10px]">{v.path}</span>
                  </div>
                  <span className="font-mono text-[11px] text-muted tabular-nums">
                    {format(v.visitedAt, 'MM-dd HH:mm')}
                  </span>
                </li>
              ))}
            </ScrollList>
          </Section>

          <Section title="拥有的 Skills">
            {skills.length === 0 ? (
              <Empty>该用户还没有发布任何 Skill</Empty>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>状态</th>
                    <th>下载</th>
                    <th>更新</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link href={`/skills/${s.slug}`} className="font-medium hover:underline">
                          {s.name}
                        </Link>
                      </td>
                      <td>
                        <span
                          className="badge"
                          style={{
                            background: s.status === 'published' ? '#dcfce7' : '#fef3c7',
                            color: s.status === 'published' ? '#166534' : '#92400e',
                          }}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="font-mono tabular-nums">{s.downloadCount}</td>
                      <td className="font-mono text-[11px] tabular-nums">
                        {formatDistanceToNowStrict(s.updatedAt, { addSuffix: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="管理员操作记录">
            <ScrollList>
              {adminActions.length === 0 && <Empty>暂无管理员对该用户的操作</Empty>}
              {adminActions.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-accent-600">{a.action}</span>
                    <span className="text-muted">by {a.adminUser.displayName}</span>
                  </div>
                  <span className="font-mono text-[11px] text-muted tabular-nums">
                    {format(a.createdAt, 'MM-dd HH:mm')}
                  </span>
                </li>
              ))}
            </ScrollList>
          </Section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-3">
          <Section title="活动数据">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Counter label="拥有 Skill" value={user._count.skills} />
              <Counter label="评论数" value={user._count.reviews} />
              <Counter label="订阅数" value={user._count.subscriptions} />
              <Counter label="收藏数" value={user._count.favorites} />
              <Counter label="点赞数" value={user._count.likes} />
              <Counter label="CLI Token" value={user._count.cliTokens} />
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface rounded-xl p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Dt({ children }: { children: React.ReactNode }) {
  return <dt className="text-[11px] uppercase tracking-wider text-muted">{children}</dt>;
}
function Dd({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <dd className={`text-sm ${className}`}>{children}</dd>;
}

function ScrollList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto pr-1 dark:divide-zinc-800">
      {children}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <li className="py-4 text-center text-xs text-muted">{children}</li>;
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
