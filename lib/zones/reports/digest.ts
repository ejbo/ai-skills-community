// 版块报告 — 摘录 / 统计 / 切片（与 skill 的 digest.mjs、slice.mjs、outline.mjs 同规则）。纯函数。

import type { ClusterResult, ParsedChat, ParsedMessage, RecapResult, ReportStats, ThemeResult } from './schema';
import { SUBSTANTIVE_TYPES } from './schema';
import { URL_RE } from './parse';

export const DIGEST_MAX_CHARS = 60_000;
const LINE_CHARS = 160;

function truncate(s: string, n: number): string {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const p = (u.pathname + (u.search ? '?' : '')).slice(0, 28);
    return u.host.replace(/^www\./, '') + (p === '/' ? '' : p);
  } catch {
    return url.slice(0, 40);
  }
}

export function computeStats(chat: ParsedChat): ReportStats {
  const byType: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const bySpeaker = new Map<string, { account: string; name: string; count: number }>();
  const hosts: Record<string, number> = {};
  let attachments = chat.orphanAttachments.length;
  let placeholders = 0;
  for (const m of chat.messages) {
    byType[m.type] = (byType[m.type] ?? 0) + 1;
    byDay[m.date] = (byDay[m.date] ?? 0) + 1;
    const s = bySpeaker.get(m.account) ?? { account: m.account, name: m.name, count: 0 };
    s.count++;
    bySpeaker.set(m.account, s);
    for (const l of m.links) hosts[l.host || '?'] = (hosts[l.host || '?'] ?? 0) + 1;
    attachments += m.attachments.length;
    if (m.hasAttachmentPlaceholder || m.type === 'image' || m.type === 'file') placeholders++;
  }
  const days = Object.entries(byDay).sort() as [string, number][];
  const peak = days.reduce<[string, number]>((a, b) => (b[1] > a[1] ? b : a), ['', 0]);
  return {
    messages: chat.messages.length,
    substantive: chat.messages.filter((m) => SUBSTANTIVE_TYPES.has(m.type)).length,
    speakers: bySpeaker.size,
    activeDays: days.length,
    peakDay: { date: peak[0], count: peak[1] },
    byType,
    byDay: days,
    bySpeaker: [...bySpeaker.values()].sort((a, b) => b.count - a.count),
    links: chat.messages.reduce((n, m) => n + m.links.length, 0),
    linkHosts: (Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 20) as [string, number][]),
    attachments,
    attachmentPlaceholders: placeholders,
  };
}

function digestLine(m: ParsedMessage): string {
  const t = m.time.slice(11, 16);
  const reply = m.replyTo && m.replyTo.id ? ` ↳${m.replyTo.id}` : m.replyTo ? ` ↳(回复 ${m.replyTo.name})` : '';
  let body = m.text || '';
  if (m.type === 'link_card') body = `〔链接卡片〕${m.cardTitle || body}`;
  body = body.replace(URL_RE, '').replace(/\s+/g, ' ').trim();
  const parts = [`- ${m.id} ${t} ${m.name}${reply}: ${truncate(body, LINE_CHARS)}`];
  if (m.links.length) parts.push(`[链接: ${m.links.map((l) => shortUrl(l.url)).slice(0, 3).join(' ; ')}]`);
  const n = m.attachments.length || (m.hasAttachmentPlaceholder ? 1 : 0);
  if (n) parts.push(`[图/附件×${n}]`);
  if (m.mentions.length && !body.includes('@')) parts.push(`[@${m.mentions.slice(0, 3).join(' @')}]`);
  return parts.join(' ');
}

/**
 * 聚类输入：只含有信息量的消息、一行一条、行首是 id。超过 maxChars 时按天拆成多份
 * （每份都带 header），返回 parts.length > 1 ⇒ 要逐片聚类再合并。
 */
export function buildDigest(chat: ParsedChat, stats: ReportStats, maxChars = DIGEST_MAX_CHARS): { parts: string[]; total: number } {
  const header = [
    `# ${chat.subject} · 聊天摘录（供主题聚类）`,
    ``,
    `区间 ${chat.period.start} ~ ${chat.period.end} · 消息 ${stats.messages}（有信息量 ${stats.substantive}）· 发言人 ${stats.speakers} · 图/附件占位 ${stats.attachmentPlaceholders}`,
    ``,
    `## 发言人（账号 → 姓名 · 条数）`,
    ...stats.bySpeaker.slice(0, 40).map((s) => `- ${s.account} → ${s.name} · ${s.count}`),
    ``,
    `## 消息（按天；行首是消息 id，归类时只引用 id）`,
    ``,
  ].join('\n');
  const dayBlocks: { day: string; text: string }[] = [];
  for (const [day, count] of stats.byDay) {
    const dm = chat.messages.filter((m) => m.date === day);
    const kept = dm.filter((m) => SUBSTANTIVE_TYPES.has(m.type));
    const imgs = dm.filter((m) => m.type === 'image' || m.type === 'file').length;
    dayBlocks.push({ day, text: [`### ${day} · ${count} 条（有信息量 ${kept.length}，图/附件 ${imgs}）`, ...kept.map(digestLine), ``].join('\n') });
  }
  const full = `${header}\n${dayBlocks.map((b) => b.text).join('\n')}`;
  if (full.length <= maxChars) return { parts: [full], total: full.length };
  const parts: string[] = [];
  let cur: typeof dayBlocks = [];
  let curLen = header.length;
  for (const b of dayBlocks) {
    if (cur.length && curLen + b.text.length > maxChars) {
      parts.push(cur.map((x) => x.text).join('\n'));
      cur = [];
      curLen = header.length;
    }
    cur.push(b);
    curLen += b.text.length;
  }
  if (cur.length) parts.push(cur.map((x) => x.text).join('\n'));
  return {
    parts: parts.map((p, i) => `${header.replace('（供主题聚类）', `（供主题聚类 · 第 ${i + 1}/${parts.length} 份）`)}\n${p}`),
    total: full.length,
  };
}

function msgBlock(m: ParsedMessage, byId: Map<string, ParsedMessage>): string {
  const lines = [`### ${m.id} · ${m.time} · ${m.name}（${m.account}）`];
  if (m.replyTo) {
    const target = m.replyTo.id ? byId.get(m.replyTo.id) : null;
    const quoted = (target ? target.text || target.raw || '' : m.replyTo.content).slice(0, 160).replace(/\s+/g, ' ');
    lines.push(`> 回复 ${m.replyTo.id ?? ''} ${m.replyTo.name}：「${quoted}」`);
  }
  if (m.type === 'link_card') lines.push(`〔链接卡片〕${m.cardTitle ?? ''}${m.cardDigest ? ` — ${m.cardDigest}` : ''}`);
  else lines.push(m.text || (m.type === 'image' ? '（图片）' : m.type === 'file' ? '（文件）' : ''));
  if (m.links.length) lines.push(`链接：${m.links.map((l) => l.url).join(' ; ')}`);
  if (m.attachments.length) lines.push(`附件：${m.attachments.map((a) => `${a.file}${a.present === false ? '（未上传）' : ''}`).join(' ; ')}`);
  else if (m.hasAttachmentPlaceholder) lines.push('附件：（有图片/附件，文件名未知）');
  return lines.join('\n');
}

/** 一个主题的 bundle：全文 + 引用上下文 + 本主题出现过的全部链接。 */
export function buildThemeBundle(chat: ParsedChat, theme: ClusterResult['themes'][number]): string {
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  const order = new Map(chat.messages.map((m, i) => [m.id, i]));
  const ids = [...new Set(theme.msgIds)].filter((id) => byId.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
  const msgs = ids.map((id) => byId.get(id)!);
  const ctxIds = new Set<string>();
  for (const m of msgs) if (m.replyTo?.id && !ids.includes(m.replyTo.id)) ctxIds.add(m.replyTo.id);
  const speakers = new Map<string, string>();
  for (const m of msgs) speakers.set(m.account, m.name);
  const links: { url: string; title: string | null; msgId: string; speaker: string }[] = [];
  for (const m of msgs) for (const l of m.links) if (!links.some((x) => x.url === l.url)) links.push({ url: l.url, title: l.title, msgId: m.id, speaker: m.name });
  const dates = [...new Set(msgs.map((m) => m.date))];
  const out = [
    `# ${theme.id} · ${theme.title}`,
    ``,
    `主题定位（聚类时给的初稿，可改）：${theme.tagline}`,
    `消息 ${msgs.length} 条 · 日期 ${dates[0]} ~ ${dates[dates.length - 1]} · 发言人：${[...speakers.entries()].map(([a, n]) => `${n}（${a}）`).join('、')}`,
    ``,
    `> 写摘要时只能引用下面这些消息 id；url 只能从「本主题出现的链接」里选；发言人/账号必须与下面一致。`,
    ``,
    `## 消息（全文，按时间）`,
    ``,
    ...msgs.map((m) => msgBlock(m, byId)),
    ``,
  ];
  if (ctxIds.size) out.push(`## 被引用的上下文消息（不属于本主题，仅供理解）`, ``, ...[...ctxIds].map((id) => msgBlock(byId.get(id)!, byId)), ``);
  out.push(`## 本主题出现的链接（url 必须从这里选）`, ``);
  out.push(...(links.length ? links.map((l) => `- ${l.url}${l.title ? ` 〔${l.title}〕` : ''}（${l.msgId}，${l.speaker}）`) : ['（无链接）']), ``);
  return out.join('\n');
}

/** events / recap 的 bundle（没有对应消息返回 null）。 */
export function buildListBundle(chat: ParsedChat, ids: string[], title: string): string | null {
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  const order = new Map(chat.messages.map((m, i) => [m.id, i]));
  const sorted = [...new Set(ids)].filter((id) => byId.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
  if (!sorted.length) return null;
  const msgs = sorted.map((id) => byId.get(id)!);
  const links: { url: string; title: string | null; msgId: string; speaker: string }[] = [];
  for (const m of msgs) for (const l of m.links) if (!links.some((x) => x.url === l.url)) links.push({ url: l.url, title: l.title, msgId: m.id, speaker: m.name });
  return [
    `# ${title}`,
    ``,
    `消息 ${msgs.length} 条`,
    ``,
    `## 消息（全文，按时间）`,
    ``,
    ...msgs.map((m) => msgBlock(m, byId)),
    ``,
    `## 出现的链接（url 必须从这里选）`,
    ``,
    ...(links.length ? links.map((l) => `- ${l.url}${l.title ? ` 〔${l.title}〕` : ''}（${l.msgId}，${l.speaker}）`) : ['（无链接）']),
    ``,
  ].join('\n');
}

/** 各主题提纲（写要点用）。 */
export function buildOutline(themes: ThemeResult[], recap: RecapResult | null): string {
  const lines = ['# 各主题提纲（供写总览要点）', ''];
  for (const t of themes) {
    lines.push(`## ${t.id} · ${t.title}`, `主题定位：${t.tagline}`);
    for (const m of t.macro) lines.push(`- 【${m.tag}】${m.text}`);
    lines.push(`观点（${t.viewpoints.length} 条）：${t.viewpoints.map((v) => `${v.speaker}${v.role ? `(${v.role})` : ''}: ${v.text.slice(0, 60)}`).join(' / ')}`);
    if (t.conclusion) lines.push(`结论：${t.conclusion}`);
    if (t.openQuestions.length) lines.push(`待验证：${t.openQuestions.join('；')}`);
    lines.push('');
  }
  if (recap?.events.length) lines.push('## 活动', ...recap.events.map((e) => `- ${e.date ?? ''} ${e.title}`), '');
  if (recap?.recap?.items.length) lines.push('## 非科研 Recap', ...recap.recap.items.map((i) => `- ${i.text.slice(0, 80)}`), '');
  return lines.join('\n');
}
