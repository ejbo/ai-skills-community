// 版块报告 — 装配最终 report.json（与 skill assemble.mjs 同规则）。模型不参与。
// 做的事：按账号统一发言人姓名、给观点编号、把图片按「同一消息 / 同人邻近消息」跟随到观点下、
// 其余附件进附录、记录未归类消息、带上统计。

import type { ClusterResult, OverviewResult, ParsedChat, RecapResult, Report, ReportAttachment, ReportKind, ReportStats, ReportTheme, ThemeResult } from './schema';
import { SUBSTANTIVE_TYPES } from './schema';
import { fmtMMDD } from './parse';

export interface AssembleInput {
  chat: ParsedChat;
  stats: ReportStats;
  cluster: ClusterResult;
  themes: ThemeResult[];
  recap: RecapResult | null;
  overview: OverviewResult;
  kind?: ReportKind;
  title?: string;
  periodLabel?: string;
  from?: string;
  to?: string;
  model?: string | null;
  /** 文件名 → 站内 asset key（已上传的才有）。 */
  assetKeys?: ReadonlyMap<string, string>;
}

export function guessKind(start: string, end: string): ReportKind {
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1;
  if (days <= 1) return 'daily';
  if (days <= 8) return 'weekly';
  if (days <= 32) return 'monthly';
  return 'custom';
}

export function defaultPeriodLabel(kind: ReportKind, start: string, end: string): string {
  if (kind === 'monthly') return `${start.slice(0, 4)} 年 ${parseInt(start.slice(5, 7), 10)} 月`;
  if (kind === 'daily') return start;
  return `${start} ~ ${end}`;
}

export const KIND_LABEL: Record<ReportKind, string> = { daily: '日报', weekly: '周报', monthly: '月报', custom: '报告' };

export function assembleReport(input: AssembleInput): Report {
  const { chat, stats, cluster, overview } = input;
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  const order = new Map(chat.messages.map((m, i) => [m.id, i]));
  const nameOf = (acct: string) => chat.roster.find((r) => r.account === acct.toLowerCase())?.name ?? acct;
  const assetKeys = input.assetKeys ?? new Map<string, string>();

  // 附件池
  const pool: ReportAttachment[] = [];
  let seq = 0;
  for (const m of chat.messages) {
    for (const a of m.attachments) {
      const assetKey = assetKeys.get(a.file) ?? null;
      pool.push({ id: `a${++seq}`, file: a.file, kind: a.kind, size: a.size, url: a.url, code: a.code, msgId: m.id, account: m.account, name: m.name, time: m.time, present: assetKey ? true : a.present === true, placement: { kind: 'appendix' }, assetKey });
    }
  }
  for (const a of chat.orphanAttachments) {
    const assetKey = assetKeys.get(a.file) ?? null;
    pool.push({ id: `a${++seq}`, file: a.file, kind: a.kind, size: a.size, url: a.url, code: a.code, msgId: null, account: a.account, name: a.name || nameOf(a.account), time: a.time, present: assetKey ? true : a.present === true, placement: { kind: 'appendix' }, assetKey });
  }
  const poolByMsg = new Map<string, ReportAttachment[]>();
  for (const a of pool) if (a.msgId) (poolByMsg.get(a.msgId) ?? poolByMsg.set(a.msgId, []).get(a.msgId)!).push(a);
  const taken = new Set<string>();

  function follow(msgRefs: string[], placement: ReportAttachment['placement']): string[] {
    const got: string[] = [];
    const take = (a: ReportAttachment) => {
      if (taken.has(a.id) || !a.present) return;
      taken.add(a.id);
      a.placement = placement;
      got.push(a.id);
    };
    for (const ref of msgRefs) {
      const m = byId.get(ref);
      if (!m) continue;
      for (const a of poolByMsg.get(ref) ?? []) take(a);
      const i = order.get(ref)!;
      for (let j = Math.max(0, i - 2); j <= Math.min(chat.messages.length - 1, i + 6); j++) {
        const n = chat.messages[j];
        if (n.id === ref || n.account !== m.account) continue;
        if (Math.abs(n.ts - m.ts) > 15 * 60 * 1000) continue;
        if (n.type !== 'image' && n.type !== 'file') continue;
        for (const a of poolByMsg.get(n.id) ?? []) take(a);
      }
    }
    return got;
  }

  const themeById = new Map(input.themes.map((t) => [t.id, t]));
  const themes: ReportTheme[] = [];
  for (const c of cluster.themes) {
    const t = themeById.get(c.id);
    if (!t) continue;
    const msgIds = [...new Set(c.msgIds)].filter((id) => byId.has(id)).sort((a, b) => order.get(a)! - order.get(b)!);
    const viewpoints = t.viewpoints.map((v, i) => {
      const id = `${c.id}-v${i + 1}`;
      const refs = [...new Set(v.msgRefs)].filter((x) => byId.has(x));
      const dates = [...new Set(refs.map((r) => fmtMMDD(new Date(byId.get(r)!.ts))))].sort();
      const account = v.account.toLowerCase();
      return {
        id,
        speaker: nameOf(account),
        account,
        date: v.date,
        dates: dates.length ? dates : [v.date.slice(5)],
        role: v.role,
        text: v.text,
        quote: v.quote ?? undefined,
        sources: v.sources.map((s) => ({ label: s.label, url: s.url ?? undefined })),
        msgRefs: refs,
        attachments: follow(refs, { kind: 'viewpoint', id }),
      };
    });
    themes.push({
      id: c.id,
      title: t.title || c.title,
      tagline: t.tagline || c.tagline,
      weight: msgIds.length,
      msgIds,
      macro: t.macro,
      viewpoints,
      conclusion: t.conclusion,
      openQuestions: t.openQuestions,
      resources: t.resources,
    });
  }

  const recapIn = input.recap?.recap ?? null;
  const recap: Report['recap'] = recapIn
    ? {
        title: recapIn.title || '非科研 · 快速 Recap',
        items: recapIn.items.map((it, i) => {
          const refs = [...new Set(it.msgRefs)].filter((x) => byId.has(x));
          const first = refs.length ? byId.get(refs[0])! : null;
          return {
            id: `r${i + 1}`,
            text: it.text,
            speaker: first?.name,
            account: first?.account,
            date: first?.date,
            sources: it.sources.map((s) => ({ label: s.label, url: s.url ?? undefined })),
            msgRefs: refs,
            attachments: follow(refs, { kind: 'recap', id: `r${i + 1}` }),
          };
        }),
      }
    : null;
  const events: Report['events'] = (input.recap?.events ?? []).map((e, i) => {
    const refs = [...new Set(e.msgRefs)].filter((x) => byId.has(x));
    return { id: `e${i + 1}`, title: e.title, date: e.date, host: e.host, url: e.url, note: e.note, msgRefs: refs, attachments: follow(refs, { kind: 'event', id: `e${i + 1}` }) };
  });

  const assigned = new Set<string>();
  for (const t of cluster.themes) for (const id of t.msgIds) assigned.add(id);
  for (const k of ['recap', 'events', 'skip'] as const) for (const id of cluster[k]) assigned.add(id);
  const unassigned = chat.messages.filter((m) => SUBSTANTIVE_TYPES.has(m.type) && !assigned.has(m.id)).map((m) => m.id);

  const start = input.from ?? chat.period.start;
  const end = input.to ?? chat.period.end;
  const kind = input.kind ?? guessKind(start, end);
  const label = input.periodLabel?.trim() || defaultPeriodLabel(kind, start, end);
  const title = input.title?.trim() || `${chat.subject} · ${label}${KIND_LABEL[kind]}`;

  return {
    schemaVersion: 1,
    kind,
    title,
    subject: chat.subject,
    period: { start, end, label },
    generatedAt: new Date().toISOString(),
    generator: { skill: 'chat-report', version: '1.0.0', model: input.model ?? null },
    summary: {
      headline: overview.headline,
      highlights: overview.highlights,
      judgments: overview.judgments,
      actions: overview.actions.map((a) => ({ ...a, ownerAccount: a.ownerAccount ? a.ownerAccount.toLowerCase() : a.ownerAccount })),
    },
    themes,
    recap,
    events,
    attachments: pool,
    stats,
    unassigned,
  };
}
