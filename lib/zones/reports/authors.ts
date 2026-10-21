// 版块报告 — 聊天发言人（工号 / W3 账号）→ 站内用户（docs/contracts/reports.md §3）。
//
// 规则与员工名单同步完全一致（lib/employee-directory.ts）：比较的是 工号 的 DIGIT RUN
// （`l00974474` ⇔ huaweiW3Id `00974474`），`contains` 预过滤 + `accountMatchKey` 精确复核，
// 预过滤永远不单独信。只认 W3 登录过的身份（huaweiW3Id），不认 handle / email。

import { prisma } from '@/lib/db';
import { accountMatchKey } from '@/lib/employee-directory';
import { AUTHOR_IDENTITY_FIELDS, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import type { RosterEntry } from './schema';

export interface AuthorMatchRow {
  account: string;
  name: string;
  count: number;
  /** 站内用户 id（null = 未匹配 / 未登录过）。 */
  userId: string | null;
  handle: string | null;
}

export interface AuthorMatchView extends AuthorMatchRow {
  user: PublicAuthor | null;
}

/** 名单 → 匹配结果（存 ZoneReport.authorMatches；不含任何隐私字段）。 */
export async function matchRosterToUsers(roster: RosterEntry[]): Promise<AuthorMatchRow[]> {
  const keys = new Map<string, string>();
  for (const r of roster) {
    const k = accountMatchKey(r.account);
    if (k) keys.set(r.account, k);
  }
  const digits = [...new Set(keys.values())];
  if (!digits.length) return roster.map((r) => ({ account: r.account, name: r.name, count: r.count, userId: null, handle: null }));
  const users = await prisma.user.findMany({
    where: { isActive: true, huaweiW3Id: { not: null }, OR: digits.map((d) => ({ huaweiW3Id: { contains: d } })) },
    select: { id: true, handle: true, huaweiW3Id: true },
    take: Math.max(50, digits.length * 3),
  });
  const byKey = new Map<string, { id: string; handle: string }>();
  for (const u of users) {
    const k = accountMatchKey(u.huaweiW3Id);
    if (k && !byKey.has(k)) byKey.set(k, { id: u.id, handle: u.handle });
  }
  return roster.map((r) => {
    const hit = keys.has(r.account) ? byKey.get(keys.get(r.account)!) : undefined;
    return { account: r.account, name: r.name, count: r.count, userId: hit?.id ?? null, handle: hit?.handle ?? null };
  });
}

/** 给页面：补上公开身份（过 toPublicAuthor，隐私账号照常脱敏）。 */
export async function authorMatchViews(rows: AuthorMatchRow[], canSeeIdentity: boolean): Promise<AuthorMatchView[]> {
  const ids = rows.map((r) => r.userId).filter((x): x is string => !!x);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, ...AUTHOR_IDENTITY_FIELDS } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const u = r.userId ? byId.get(r.userId) : undefined;
    return { ...r, user: u ? toPublicAuthor(u, canSeeIdentity) : null };
  });
}
