import { notFound } from 'next/navigation';
import Link from 'next/link';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { prisma } from '@/lib/db';
import { requirePermission } from '@/lib/admin';
import { effectiveRole, listRoles } from '@/lib/roles';
import { MEMBER_ROLE_KEY, PERMISSIONS, hasPermission } from '@/lib/permissions';
import { displayVisitPath } from '@/lib/page-visit';
import { ToggleRow, NumberRow } from './ToggleRow';
import { RoleSelect } from './RoleSelect';
import { RoleBadge } from '../RoleBadge';

export const dynamic = 'force-dynamic';

export default async function UserDetailPage({ params }: { params: { id: string } }) {
  const actor = await requirePermission('users');

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    include: {
      role: true,
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

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [logins, visits, visitSummary, visitTotal30, skills, adminActions, roles] = await Promise.all([
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
    prisma.pageVisit.groupBy({
      by: ['pageName'],
      where: { userId: user.id, visitedAt: { gte: since30 } },
      _count: { _all: true },
      // COUNT(pageName) is 0 for the unnamed bucket — order by a non-null column.
      orderBy: { _count: { id: 'desc' } },
      take: 12,
    }),
    prisma.pageVisit.count({ where: { userId: user.id, visitedAt: { gte: since30 } } }),
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
    listRoles(),
  ]);

  const role = effectiveRole(user.role);
  const memberRoleId = roles.find((r) => r.key === MEMBER_ROLE_KEY)?.id ?? '';
  const isSelf = user.id === actor.session.user.id;
  const viewerIsSuper = actor.role.isSuperAdmin;
  // Staff accounts are a super admin's business; 用户管理 alone only touches members.
  const switchesDisabled = user.isAdmin && !viewerIsSuper ? '管理员账号仅超级管理员可修改' : null;
  const roleDisabled = !viewerIsSuper ? '仅超级管理员可指派角色' : isSelf ? '不能修改自己的角色' : null;
  const grantedPermissions = role.isSuperAdmin ? PERMISSIONS : PERMISSIONS.filter((p) => hasPermission(role, p.key));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            {user.displayName}
            <RoleBadge roleKey={role.roleKey} name={role.roleName} staff={user.isAdmin} />
          </h2>
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
              {user.huaweiW3Name && (
                <>
                  <Dt>W3 姓名（不可改）</Dt>
                  <Dd className="font-medium">{user.huaweiW3Name}</Dd>
                </>
              )}
              <Dt>部门 / 研究所</Dt>
              <Dd>
                {user.department || user.lab ? (
                  <>
                    {user.department}
                    {user.department && user.lab ? ' · ' : ''}
                    {user.lab}
                    <span className="ml-1 text-xs text-muted">（由员工名单按工号同步）</span>
                  </>
                ) : (
                  <span className="text-muted">—（员工名单中无匹配工号）</span>
                )}
              </Dd>
              <Dt>隐私账号</Dt>
              <Dd>
                {user.isPrivate ? (
                  <span className="badge" style={{ background: '#fef3c7', color: '#92400e' }}>
                    已开启 — 对普通用户仅显示昵称
                  </span>
                ) : (
                  '未开启'
                )}
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

          <Section title="角色与权限">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <RoleSelect
                userId={user.id}
                roles={roles.map((r) => ({ id: r.id, key: r.key, name: r.name }))}
                currentRoleId={user.roleId ?? memberRoleId}
                disabledReason={roleDisabled}
              />
              <div className="py-2.5">
                <div className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">
                  该角色拥有的权限{role.isSuperAdmin ? '（超级管理员：全部）' : `（${grantedPermissions.length}）`}
                </div>
                {grantedPermissions.length === 0 ? (
                  <p className="text-xs text-muted">无后台或治理权限。</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {grantedPermissions.map((p) => (
                      <span key={p.key} className="badge" style={{ background: '#f4f4f5', color: '#3f3f46' }}>
                        {p.label}
                      </span>
                    ))}
                  </div>
                )}
                {viewerIsSuper && (
                  <p className="mt-2 text-[11px] text-muted">
                    角色的权限在{' '}
                    <Link href="/manage/roles" className="underline">
                      角色与权限
                    </Link>{' '}
                    页配置。
                  </p>
                )}
              </div>
            </div>
          </Section>

          <Section title="账号开关（即时保存）">
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              <ToggleRow userId={user.id} field="isActive" label="账号启用" current={user.isActive} disabledReason={switchesDisabled ?? (isSelf ? '不能停用自己的账号' : null)} />
              <ToggleRow userId={user.id} field="canPublishSkills" label="允许发布 Skill" current={user.canPublishSkills} disabledReason={switchesDisabled} />
              <ToggleRow userId={user.id} field="canRemix" label="允许 Remix" current={user.canRemix} disabledReason={switchesDisabled} />
              <ToggleRow userId={user.id} field="canUseCli" label="允许使用 CLI（关闭后其 CLI Token 立即失效）" current={user.canUseCli} disabledReason={switchesDisabled} />
              <ToggleRow userId={user.id} field="canCreateZones" label="允许创建技术专区版块" current={user.canCreateZones} disabledReason={switchesDisabled} />
              <NumberRow userId={user.id} field="dailyDownloadLimit" label="每日下载上限（滚动 24 小时，留空不限）" current={user.dailyDownloadLimit} disabledReason={switchesDisabled} />
              <NumberRow userId={user.id} field="dailyPublishLimit" label="每日发布上限" current={user.dailyPublishLimit} disabledReason={switchesDisabled} />
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

          <Section title={`访问分布（近 30 天 · ${visitTotal30} 次）`}>
            {visitSummary.length === 0 ? (
              <p className="py-2 text-xs text-muted">近 30 天没有访问记录</p>
            ) : (
              <ul className="space-y-1.5">
                {visitSummary.map((r) => {
                  const pct = visitTotal30 ? Math.round((r._count._all / visitTotal30) * 100) : 0;
                  return (
                    <li key={r.pageName ?? '__none'} className="flex items-center gap-3 text-xs">
                      <span className="w-40 shrink-0 truncate font-medium">{r.pageName ?? '（未命名页面）'}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <span className="block h-full rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ width: `${pct}%` }} />
                      </span>
                      <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted tabular-nums">
                        {r._count._all} · {pct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title={`页面访问 (${visits.length})`}>
            {user.isAdmin && (
              <p className="mb-2 text-[11px] text-muted">
                管理员访问具体用户页面（用户详情 / 用户主页）的记录已脱敏：只记录页面类型，不记录是哪个用户。
              </p>
            )}
            <ScrollList>
              {visits.length === 0 && <Empty>暂无访问记录</Empty>}
              {visits.map((v) => {
                const shown = displayVisitPath(v.path, user.isAdmin);
                return (
                  <li key={v.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-medium dark:bg-zinc-800">
                        {v.pageName ?? shown.path}
                      </span>
                      <span className="font-mono text-[10px] text-muted">{shown.path}</span>
                      {shown.redacted && <span className="text-[10px] text-muted">（已脱敏）</span>}
                    </div>
                    <span className="font-mono text-[11px] text-muted tabular-nums">
                      {format(v.visitedAt, 'MM-dd HH:mm')}
                    </span>
                  </li>
                );
              })}
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
                    <span className="font-mono text-[11px] text-zinc-900 dark:text-zinc-50">{a.action}</span>
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
