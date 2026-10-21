// 版块报告 — report.json → 帖子 Markdown 正文（docs/contracts/reports.md §3）。
//
// 顺序与 skill 的 report.html 一致：要点 → 各专题 → 活动 → Recap → 资源索引 → 数据概览 → 附录。
// 文风同 skill 的 HTML（内部技术汇报）：章节标题带【】标签，没有「一句话」之类的标签词和统计药丸，
// 主线判断直接做引文，每个专题以「启示」收束；置信度写成括号文字，不做徽章。
// 图片 = `![](/api/zones/media/<key>)`（MarkdownRenderer 自己过 withBasePath 并接灯箱）；
// 文件 = 自成一行的 `[embed:file:<key>]`；已收录的文档 = `[embed:library:<slug>]`（右侧并排阅读）。
// 纯函数：输入 report + 文件名→key/slug 的映射，输出字符串。

import type { Report, ReportAttachment } from './schema';
import { zoneMediaPublicUrl } from '@/lib/zones/storage';
import { embedToken } from '@/lib/zones/shared';

const CONF_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const RES_LABEL: Record<string, string> = { paper: '论文', repo: '代码', article: '文章', internal: '内部', video: '视频', doc: '文档', other: '链接' };

export interface RenderMdOptions {
  /** 文件名 → 知识库 slug（已收录的附件走 library 卡片而不是 file 卡片）。 */
  librarySlugs?: ReadonlyMap<string, string>;
  /** 数据概览默认不进正文（帖子里显得啰嗦）；true 则附在末尾。 */
  includeStats?: boolean;
}

const isImg = (a: ReportAttachment) => a.kind === 'image' || /\.(png|jpe?g|gif|webp|bmp)$/i.test(a.file);
const cell = (s: string) => s.replace(/\|/g, '｜').replace(/\n/g, ' ');

export function renderReportMarkdown(report: Report, opts: RenderMdOptions = {}): string {
  const attById = new Map(report.attachments.map((a) => [a.id, a]));
  const themeNum = new Map(report.themes.map((t, i) => [t.id, String(i + 1).padStart(2, '0')]));
  const themeRef = (id?: string | null) => (id && themeNum.has(id) ? `（→ 专题 ${themeNum.get(id)}）` : '');
  const out: string[] = [];

  function media(ids: string[]): string[] {
    const lines: string[] = [];
    for (const id of ids) {
      const a = attById.get(id);
      if (!a || !a.assetKey) continue;
      const slug = opts.librarySlugs?.get(a.file);
      if (slug) lines.push(embedToken('library', slug));
      else if (isImg(a)) lines.push(`![${a.file}](${zoneMediaPublicUrl(a.assetKey)})`);
      else lines.push(embedToken('file', a.assetKey));
    }
    return lines;
  }
  const src = (list: { label: string; url?: string }[]) =>
    list.length ? `来源：${list.map((s) => (s.url ? `[${s.label}](${s.url})` : s.label)).join(' ｜ ')}` : '';

  const S = report.summary;
  if (S.headline) out.push(`> ${S.headline}`, '');
  out.push(`## 【要点】本期要点`, '');
  S.highlights.forEach((h, i) => out.push(`${i + 1}. ${h.text}${themeRef(h.themeId)}`));
  if (S.judgments.length) {
    out.push('', `**关键判断**`, '');
    for (const j of S.judgments) out.push(`- ${j.text}（置信度 ${CONF_LABEL[j.confidence] ?? '—'}）${themeRef(j.themeId)}`);
  }
  if (S.actions.length) {
    out.push('', `**待办与跟踪**`, '', `| 事项 | 负责人 | 专题 |`, `| --- | --- | --- |`);
    for (const a of S.actions) out.push(`| ${cell(a.text)} | ${cell(a.owner ?? '—')} | ${a.themeId && themeNum.has(a.themeId) ? `${themeNum.get(a.themeId)} ${cell(report.themes.find((x) => x.id === a.themeId)?.title ?? '')}` : '—'} |`);
  }
  out.push('');

  report.themes.forEach((t, i) => {
    out.push(`## 【专题 ${String(i + 1).padStart(2, '0')}】${t.title}`, '');
    if (t.tagline) out.push(t.tagline, '');
    if (t.macro.length) {
      for (const m of t.macro) out.push(`- **【${m.tag}】** ${m.text}`);
      out.push('');
    }
    out.push(`**观点时间线**`, '');
    const trailing: string[] = [];
    for (const v of t.viewpoints) {
      out.push(`- **${v.dates.join(' / ')} · ${v.speaker}**${v.role ? `［${v.role}］` : ''}：${v.text}${src(v.sources) ? ` — ${src(v.sources)}` : ''}`);
      if (v.quote) out.push(`  > ${v.quote}`);
      // 图片跟在观点下；文件 / 文档卡片是顶层令牌，放到时间线后面
      for (const line of media(v.attachments)) {
        if (line.startsWith('![')) out.push('', `  ${line}`, '');
        else trailing.push(line);
      }
    }
    out.push('');
    if (trailing.length) out.push(...trailing.flatMap((l) => [l, '']));
    if (t.openQuestions.length) out.push(`**待验证 · 待跟踪**`, '', ...t.openQuestions.map((q) => `- ${q}`), '');
    if (t.resources.length) out.push(`**本专题资料**`, '', ...t.resources.map((r) => `- [${RES_LABEL[r.kind ?? 'other'] ?? '链接'}] [${r.label}](${r.url})`), '');
    if (t.conclusion) out.push(`**启示**：${t.conclusion}`, '');
  });

  if (report.events.length) {
    out.push(`## 【活动】活动与通知`, '', `| 日期 | 活动 | 主办 / 发起 |`, `| --- | --- | --- |`);
    for (const e of [...report.events].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))) {
      out.push(`| ${e.date ?? '—'} | ${e.url ? `[${cell(e.title)}](${e.url})` : cell(e.title)}${e.note ? `<br>${cell(e.note)}` : ''} | ${cell(e.host ?? '—')} |`);
    }
    out.push('');
    const eventMedia = report.events.flatMap((e) => media(e.attachments));
    if (eventMedia.length) out.push(...eventMedia.flatMap((l) => [l, '']));
  }

  if (report.recap?.items.length) {
    out.push(`## 【动态】${report.recap.title || '非科研 · 快速 Recap'}`, '');
    for (const it of report.recap.items) {
      out.push(`- **${(it.date ?? '').slice(5)} · ${it.speaker ?? ''}**：${it.text}${src(it.sources) ? ` — ${src(it.sources)}` : ''}`);
      for (const line of media(it.attachments)) if (line.startsWith('![')) out.push('', `  ${line}`, '');
    }
    out.push('');
  }

  const groups: { id: string; rows: { label: string; url: string; kind: string }[] }[] = [];
  for (const t of report.themes) {
    const seen = new Set<string>();
    const rows: { label: string; url: string; kind: string }[] = [];
    for (const r of t.resources) if (!seen.has(r.url)) (seen.add(r.url), rows.push({ label: r.label, url: r.url, kind: r.kind ?? 'other' }));
    for (const v of t.viewpoints) for (const s of v.sources) if (s.url && !seen.has(s.url)) (seen.add(s.url), rows.push({ label: s.label, url: s.url, kind: 'other' }));
    if (rows.length) groups.push({ id: t.id, rows });
  }
  if (groups.length) {
    out.push(`## 【资料】资源索引`, '');
    for (const g of groups) {
      const t = report.themes.find((x) => x.id === g.id)!;
      out.push(`**专题 ${themeNum.get(g.id)} · ${t.title}**`, '', ...g.rows.map((r) => `- [${RES_LABEL[r.kind] ?? '链接'}] [${r.label}](${r.url})`), '');
    }
  }

  if (opts.includeStats) {
    const st = report.stats;
    out.push(
      `## 【数据】数据概览`,
      '',
      `- 区间 ${report.period.start} ~ ${report.period.end} · 消息 ${st.messages}（有信息量 ${st.substantive}）· 发言人 ${st.speakers} · 链接 ${st.links} · 图片/附件 ${st.attachments || st.attachmentPlaceholders}`,
      `- 活跃 ${st.activeDays} 天，峰值 ${st.peakDay.date}（${st.peakDay.count} 条）`,
      `- 发言 Top：${st.bySpeaker.slice(0, 6).map((s) => `${s.name} ${s.count}`).join('，')}`,
      '',
    );
  }

  const appendix = report.attachments.filter((a) => a.placement.kind === 'appendix' && a.assetKey);
  if (appendix.length) {
    out.push(`## 【附录】未随文的图片与文件`, '');
    const lines = media(appendix.map((a) => a.id));
    out.push(...lines.flatMap((l) => [l, '']));
  }
  if (report.unassigned.length) out.push(`<!-- 未归入任何专题的消息：${report.unassigned.join(' ')} -->`, '');

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** 卡片摘要：一句话主线 + 第一条要点。 */
/** 帖子摘要是纯文本字段（列表卡片 / 搜索 / 邮件都用）：去掉模型文案里的 `**关键词**` / `code` 标记。 */
export function plainReportText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim();
}

export function reportSummaryText(report: Report, max = 300): string {
  const s = plainReportText(`${report.summary.headline} ${report.summary.highlights[0]?.text ?? ''}`);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** 标签：主题标题里冒号前的名词 ≤ 6 个。 */
export function reportTags(report: Report): string[] {
  const tags: string[] = [];
  for (const t of report.themes) {
    const head = t.title.split(/[：:]/)[0].trim();
    if (head && head.length <= 16 && !tags.includes(head)) tags.push(head);
    if (tags.length >= 6) break;
  }
  return tags;
}
