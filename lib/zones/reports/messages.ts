// 版块报告 — 「看原文」：报告里每条观点 / 花絮 / 活动都带 msgRefs，这里按 id 把原始消息取出来
// （docs/contracts/reports.md §3a）。messagesJson 很大，只在这一处按需读；一次最多 MAX_IDS 条。

import { prisma } from '@/lib/db';
import { AUTHOR_IDENTITY_FIELDS, toPublicAuthor, type PublicAuthor } from '@/lib/user-identity';
import { zoneMediaPublicUrl } from '@/lib/zones/storage';
import type { AuthorMatchRow } from './authors';
import type { ParsedChat, ParsedMessage } from './schema';

export const MAX_MESSAGE_IDS = 60;

export interface ReportMessageView {
  id: string;
  time: string;
  account: string;
  name: string;
  type: ParsedMessage['type'];
  text: string;
  links: { url: string; title: string | null }[];
  replyTo: { name: string; content: string } | null;
  /** 根相对 URL（渲染时过 withBasePath）；没上传的图只有文件名。 */
  attachments: { file: string; kind: 'image' | 'file'; url: string | null }[];
  cardTitle: string | null;
  cardDigest: string | null;
  /** 工号匹配到的站内用户（头像 / 悬停名片）。 */
  user: PublicAuthor | null;
}

/** ids 形如 "m12,m13"；非法 / 不存在的 id 直接忽略。顺序按消息时间。 */
export function parseMessageIds(raw: string | string[] | undefined): string[] {
  const s = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const out: string[] = [];
  for (const part of s.split(/[,\s]+/)) {
    if (/^m\d{1,6}$/.test(part) && !out.includes(part)) out.push(part);
    if (out.length >= MAX_MESSAGE_IDS) break;
  }
  return out;
}

export async function getReportMessages(zoneId: string, reportId: string, ids: string[], canSeeIdentity: boolean): Promise<{ subject: string; messages: ReportMessageView[] } | null> {
  const row = await prisma.zoneReport.findFirst({
    where: { id: reportId, zoneId },
    select: { subject: true, messagesJson: true, authorMatches: true, assets: { select: { key: true, name: true } } },
  });
  if (!row) return null;
  const chat = row.messagesJson as unknown as ParsedChat | null;
  const all = chat?.messages ?? [];
  const want = new Set(ids);
  const picked = all.filter((m) => want.has(m.id)).sort((a, b) => a.ts - b.ts);
  const assetByName = new Map(row.assets.map((a) => [a.name, a.key]));

  const matches = Array.isArray(row.authorMatches) ? (row.authorMatches as unknown as AuthorMatchRow[]) : [];
  const userIds = [...new Set(matches.map((m) => m.userId).filter((id): id is string => !!id))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, ...AUTHOR_IDENTITY_FIELDS } }) : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const userByAccount = new Map<string, PublicAuthor>();
  for (const m of matches) {
    const u = m.userId ? byId.get(m.userId) : undefined;
    if (u) userByAccount.set(m.account.toLowerCase(), toPublicAuthor(u, canSeeIdentity));
  }

  return {
    subject: chat?.subject ?? row.subject,
    messages: picked.map((m) => ({
      id: m.id,
      time: m.time,
      account: m.account,
      name: m.name,
      type: m.type,
      text: m.text || m.raw,
      links: m.links.map((l) => ({ url: l.url, title: l.title })),
      replyTo: m.replyTo ? { name: m.replyTo.name, content: m.replyTo.content } : null,
      attachments: m.attachments.map((a) => {
        const key = a.assetKey ?? assetByName.get(a.file) ?? null;
        return { file: a.file, kind: a.kind, url: key ? zoneMediaPublicUrl(key) : null };
      }),
      cardTitle: m.cardTitle ?? null,
      cardDigest: m.cardDigest ?? null,
      user: userByAccount.get(m.account.toLowerCase()) ?? null,
    })),
  };
}
