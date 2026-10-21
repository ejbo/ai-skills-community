// 报告 → Word（.docx）（docs/contracts/reports.md §3c）。纯 JS（`docx` 包），不依赖 LibreOffice；
// PDF 由 export-pdf.ts 用 soffice 从这份 docx 转，所以两种导出版式一致。
// 文风同 skill 的 HTML：华为红标题 + 【】章节标签、要点编号、专题 → 宏观 / 时间线 / 启示（红底白字）、
// 活动表、资源索引、页脚贡献人 / 来源。图片按文件读进来（png/jpg/gif/bmp；webp/avif Word 不认，只留文件名）。

import fsp from 'node:fs/promises';
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import { probeZoneImageSize, zoneMediaAbsPath } from '@/lib/zones/storage';
import type { Report, ReportAttachment } from './schema';

const RED = 'E60012';
const INK = '1F1F1F';
const SUB = '666666';
const LINE = 'D9D9D9';
const PANEL = 'F5F5F5';
const KIND_LABEL: Record<string, string> = { daily: '日报', weekly: '周报', monthly: '月报', custom: '技术动态' };
const RES_LABEL: Record<string, string> = { paper: '论文', repo: '代码', article: '文章', internal: '内部', video: '视频', doc: '文档', other: '链接' };
const CONF_LABEL: Record<string, string> = { high: '高', medium: '中', low: '低' };
const MAX_IMG_W = 520;
const MAX_IMG_H = 360;

const border = { style: BorderStyle.SINGLE, size: 4, color: LINE };
const borders = { top: border, bottom: border, left: border, right: border };

const LINK_COLOR = '1A4D8F';
const URL_IN_TEXT = /https?:\/\/[^\s"'<>（）()，。；！？《》「」【】\\|}]+/g;

/** 正文里裸写的 URL → 可点击的超链接（owner 2026-10-21：「生成的 pdf 或 word 里这个链接需要可以点击的」）。 */
function textWithLinks(text: string, opts: { size: number; color: string; bold?: boolean }): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  URL_IN_TEXT.lastIndex = 0;
  while ((m = URL_IN_TEXT.exec(text))) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), ...opts }));
    out.push(new ExternalHyperlink({ link: url, children: [new TextRun({ text: url, size: opts.size, color: LINK_COLOR, underline: {} })] }));
    last = m.index + url.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), ...opts }));
  return out;
}

/** `**…**` → 红色加粗；`code` → 等宽；裸 URL → 超链接。 */
function runs(text: string, base: { size?: number; color?: string; bold?: boolean } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const size = base.size ?? 21;
  const plain = { size, color: base.color ?? INK, bold: base.bold };
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...textWithLinks(text.slice(last, m.index), plain));
    if (m[1] !== undefined) out.push(new TextRun({ text: m[1], size, color: RED, bold: true, shading: { type: ShadingType.CLEAR, fill: 'FFF2CC', color: 'auto' } }));
    else out.push(new TextRun({ text: m[2], size, font: 'Consolas', color: base.color ?? INK }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...textWithLinks(text.slice(last), plain));
  return out;
}

function p(children: ParagraphChild[] | string, opts: IParagraphOptions = {}): Paragraph {
  return new Paragraph({ spacing: { after: 100, line: 300 }, ...opts, children: typeof children === 'string' ? runs(children) : children });
}

function h1(text: string): Paragraph {
  return new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 160 }, children: [new TextRun({ text, size: 40, bold: true, color: RED })] });
}
function h2(tag: string, text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 140 },
    border: { left: { style: BorderStyle.SINGLE, size: 24, color: RED, space: 8 } },
    children: [new TextRun({ text: `【${tag}】${text}`, size: 30, bold: true, color: RED })],
  });
}
function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 100 },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: RED, space: 6 } },
    children: [new TextRun({ text, size: 24, bold: true, color: INK })],
  });
}
function muted(text: string): Paragraph {
  return p([new TextRun({ text, size: 18, color: SUB })]);
}
function link(label: string, url: string): ExternalHyperlink {
  return new ExternalHyperlink({ link: url, children: [new TextRun({ text: label, size: 19, color: LINK_COLOR, underline: {} })] });
}
function cell(children: Paragraph[], opts: { width?: number; fill?: string } = {}): TableCell {
  return new TableCell({
    children,
    borders,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}
function headCell(text: string, width?: number): TableCell {
  return cell([new Paragraph({ children: [new TextRun({ text, size: 19, bold: true, color: INK })] })], { width, fill: PANEL });
}
function table(rows: TableRow[]): Table {
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

type ImgType = 'png' | 'jpg' | 'gif' | 'bmp';
function imgType(file: string): ImgType | null {
  const ext = file.toLowerCase().split('.').pop();
  if (ext === 'png') return 'png';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  if (ext === 'gif') return 'gif';
  if (ext === 'bmp') return 'bmp';
  return null;
}

async function imageParagraphs(atts: ReportAttachment[]): Promise<Paragraph[]> {
  const out: Paragraph[] = [];
  for (const a of atts) {
    const caption = `${a.file}${a.name ? ` · ${a.name}` : ''}${a.time ? ` · ${a.time.slice(5, 16)}` : ''}`;
    const type = a.kind === 'image' ? imgType(a.file) : null;
    const abs = a.assetKey ? zoneMediaAbsPath(a.assetKey) : null;
    if (!type || !abs || !a.assetKey) {
      out.push(muted(`［${a.kind === 'image' ? '图片' : '文件'}］${caption}`));
      continue;
    }
    try {
      const data = await fsp.readFile(abs);
      const dims = (await probeZoneImageSize(a.assetKey)) ?? { width: MAX_IMG_W, height: Math.round(MAX_IMG_W * 0.66) };
      const scale = Math.min(1, MAX_IMG_W / Math.max(1, dims.width), MAX_IMG_H / Math.max(1, dims.height));
      out.push(
        new Paragraph({
          spacing: { before: 80, after: 40 },
          children: [new ImageRun({ type, data, transformation: { width: Math.max(1, Math.round(dims.width * scale)), height: Math.max(1, Math.round(dims.height * scale)) } })],
        }),
      );
      out.push(muted(caption));
    } catch {
      out.push(muted(`［图片读取失败］${caption}`));
    }
  }
  return out;
}

export async function buildReportDocx(report: Report): Promise<Buffer> {
  const attById = new Map(report.attachments.map((a) => [a.id, a]));
  const themeNo = new Map(report.themes.map((t, i) => [t.id, String(i + 1).padStart(2, '0')]));
  const kindLabel = KIND_LABEL[report.kind] ?? '报告';
  const st = report.stats;
  const S = report.summary;
  const body: (Paragraph | Table)[] = [];
  const atts = (ids: string[]) => ids.map((id) => attById.get(id)).filter((a): a is ReportAttachment => !!a && a.present !== false);

  // 报头
  body.push(muted(`${report.subject} · 技术动态　｜　${kindLabel} · ${report.period.start} ~ ${report.period.end}`));
  body.push(h1(`【${kindLabel}】${report.title}`));
  if (S.headline) {
    body.push(
      new Paragraph({
        spacing: { after: 120 },
        border: { left: { style: BorderStyle.SINGLE, size: 24, color: RED, space: 10 } },
        children: runs(S.headline, { size: 24, bold: true }),
      }),
    );
  }
  body.push(muted(`${st.messages} 条消息 · ${st.speakers} 位发言人 · ${report.themes.length} 个专题 · ${st.attachments || st.attachmentPlaceholders} 张图片/附件${report.events.length ? ` · ${report.events.length} 场活动` : ''}`));

  // 要点
  body.push(h2('要点', '本期要点'));
  body.push(h3('要点'));
  S.highlights.forEach((h, i) => body.push(p([new TextRun({ text: `${i + 1}. `, size: 21, bold: true, color: RED }), ...runs(h.text), ...(h.themeId && themeNo.has(h.themeId) ? [new TextRun({ text: `（→ 专题 ${themeNo.get(h.themeId)}）`, size: 17, color: SUB })] : [])])));
  if (S.judgments.length) {
    body.push(h3('关键判断'));
    for (const j of S.judgments) body.push(p([new TextRun({ text: '■ ', size: 18, color: RED }), ...runs(j.text), new TextRun({ text: `（置信度 ${CONF_LABEL[j.confidence] ?? j.confidence}）`, size: 17, color: SUB })]));
  }
  if (S.actions.length) {
    body.push(h3('待办与跟踪'));
    body.push(
      table([
        new TableRow({ tableHeader: true, children: [headCell('事项', 60), headCell('负责人', 22), headCell('专题', 18)] }),
        ...S.actions.map(
          (a) =>
            new TableRow({
              children: [
                cell([p(a.text)]),
                cell([p([new TextRun({ text: a.owner ?? '—', size: 19 }), ...(a.ownerAccount ? [new TextRun({ text: ` ${a.ownerAccount}`, size: 15, color: SUB, font: 'Consolas' })] : [])])]),
                cell([p([new TextRun({ text: a.themeId && themeNo.has(a.themeId) ? `${themeNo.get(a.themeId)} ${report.themes.find((t) => t.id === a.themeId)?.title ?? ''}` : '—', size: 19 })])]),
              ],
            }),
        ),
      ]),
    );
  }

  // 专题
  for (const [i, t] of report.themes.entries()) {
    body.push(h2(`专题 ${String(i + 1).padStart(2, '0')}`, t.title));
    if (t.tagline) body.push(p(runs(t.tagline, { color: SUB })));
    if (t.macro.length) {
      for (const m of t.macro) body.push(new Paragraph({ spacing: { after: 60 }, shading: { type: ShadingType.CLEAR, fill: PANEL, color: 'auto' }, indent: { left: 120 }, children: [new TextRun({ text: `【${m.tag}】`, size: 21, bold: true, color: RED }), ...runs(m.text)] }));
    }
    body.push(h3('观点时间线'));
    for (const v of t.viewpoints) {
      body.push(
        new Paragraph({
          spacing: { before: 160, after: 40 },
          children: [
            new TextRun({ text: v.dates.join(' / '), size: 17, color: SUB, font: 'Consolas' }),
            new TextRun({ text: '　' }),
            new TextRun({ text: v.speaker, size: 21, bold: true, color: INK, shading: { type: ShadingType.CLEAR, fill: PANEL, color: 'auto' } }),
            new TextRun({ text: ` ${v.account}`, size: 15, color: SUB, font: 'Consolas' }),
            ...(v.role ? [new TextRun({ text: `　${v.role}`, size: 17, bold: true, color: 'FFFFFF', shading: { type: ShadingType.CLEAR, fill: v.role === '提出' ? RED : v.role === '质疑' ? 'B35A00' : v.role === '进展' ? '2B6CB0' : '555555', color: 'auto' } })] : []),
          ],
        }),
      );
      body.push(p(runs(v.text), { indent: { left: 240 } }));
      if (v.quote) body.push(new Paragraph({ indent: { left: 360 }, spacing: { after: 60 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: LINE, space: 8 } }, children: [new TextRun({ text: v.quote, size: 19, color: SUB })] }));
      body.push(...(await imageParagraphs(atts(v.attachments))));
      const srcs = v.sources.filter((s) => s.url || s.label);
      if (srcs.length) {
        const children: ParagraphChild[] = [new TextRun({ text: '来源：', size: 17, color: SUB })];
        srcs.forEach((s, k) => {
          if (k) children.push(new TextRun({ text: '　', size: 17 }));
          children.push(s.url ? link(s.label, s.url) : new TextRun({ text: s.label, size: 17, color: SUB }));
        });
        body.push(new Paragraph({ indent: { left: 240 }, spacing: { after: 80 }, children }));
      }
    }
    if (t.openQuestions.length) {
      body.push(h3('待验证 · 待跟踪'));
      for (const q of t.openQuestions) body.push(p([new TextRun({ text: '○ ', size: 19, color: SUB }), ...runs(q)]));
    }
    if (t.resources.length) {
      body.push(h3('本专题资料'));
      for (const r of t.resources) body.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: `[${RES_LABEL[r.kind ?? 'other'] ?? '链接'}] `, size: 17, color: SUB }), link(r.label, r.url)] }));
    }
    if (t.conclusion) {
      body.push(
        new Paragraph({
          spacing: { before: 200, after: 200 },
          shading: { type: ShadingType.CLEAR, fill: RED, color: 'auto' },
          indent: { left: 120, right: 120 },
          children: [new TextRun({ text: '启示　', size: 21, bold: true, color: 'FFFFFF' }), ...runs(t.conclusion, { color: 'FFFFFF', bold: true })],
        }),
      );
    }
  }

  // 活动
  if (report.events.length) {
    body.push(h2('活动', '活动与通知'));
    body.push(
      table([
        new TableRow({ tableHeader: true, children: [headCell('日期', 16), headCell('活动', 60), headCell('主办 / 发起', 24)] }),
        ...[...report.events]
          .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
          .map(
            (e) =>
              new TableRow({
                children: [
                  cell([p([new TextRun({ text: e.date ?? '—', size: 19, font: 'Consolas' })])]),
                  cell([new Paragraph({ children: [e.url ? link(e.title, e.url) : new TextRun({ text: e.title, size: 19 })] }), ...(e.note ? [p(runs(e.note, { size: 17, color: SUB }))] : [])]),
                  cell([p([new TextRun({ text: e.host ?? '—', size: 19 })])]),
                ],
              }),
          ),
      ]),
    );
  }

  // Recap
  if (report.recap?.items.length) {
    body.push(h2('动态', report.recap.title || '非科研 · 快速 Recap'));
    for (const it of report.recap.items) {
      const children: ParagraphChild[] = [new TextRun({ text: `${(it.date ?? '').slice(5)} · ${it.speaker ?? ''}　`, size: 19, bold: true }), ...runs(it.text)];
      for (const s of it.sources) if (s.url) children.push(new TextRun({ text: '　', size: 17 }), link(s.label, s.url));
      body.push(p(children));
    }
  }

  // 资源索引
  const groups = report.themes
    .map((t) => {
      const seen = new Set<string>();
      const rows: { label: string; url: string; kind: string }[] = [];
      for (const r of t.resources) if (!seen.has(r.url)) (seen.add(r.url), rows.push({ label: r.label, url: r.url, kind: r.kind ?? 'other' }));
      for (const v of t.viewpoints) for (const s of v.sources) if (s.url && !seen.has(s.url)) (seen.add(s.url), rows.push({ label: s.label, url: s.url, kind: 'other' }));
      return { t, rows };
    })
    .filter((g) => g.rows.length);
  if (groups.length) {
    body.push(h2('资料', '资源索引'));
    for (const g of groups) {
      body.push(h3(`专题 ${themeNo.get(g.t.id)} · ${g.t.title}`));
      for (const r of g.rows) body.push(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: `[${RES_LABEL[r.kind] ?? '链接'}] `, size: 17, color: SUB }), link(r.label, r.url)] }));
    }
  }

  // 数据
  body.push(h2('数据', '数据概览'));
  body.push(
    table([
      new TableRow({ tableHeader: true, children: ['区间', '消息', '有信息量', '发言人', '链接', '图片/附件', '活跃天数', '峰值日'].map((x) => headCell(x)) }),
      new TableRow({ children: [`${report.period.start} ~ ${report.period.end}`, st.messages, st.substantive, st.speakers, st.links, st.attachments || st.attachmentPlaceholders, st.activeDays, `${st.peakDay.date}（${st.peakDay.count} 条）`].map((x) => cell([p([new TextRun({ text: String(x), size: 19 })])])) }),
    ]),
  );
  body.push(muted(`发言 Top：${st.bySpeaker.slice(0, 8).map((s) => `${s.name} ${s.count}`).join('，')}`));

  // 附录
  const appendix = report.attachments.filter((a) => a.placement.kind === 'appendix' && a.present !== false && a.assetKey);
  if (appendix.length) {
    body.push(h2('附录', '未随文的图片与文件'));
    body.push(...(await imageParagraphs(appendix)));
  }

  // 页脚三件套
  const contributors = st.bySpeaker.slice(0, 8).map((s) => s.name).join('、');
  body.push(new Paragraph({ spacing: { before: 360 }, border: { top: { style: BorderStyle.SINGLE, size: 12, color: RED, space: 6 } }, children: [new TextRun({ text: `贡献人：${contributors || '—'}　｜　来源：WeLink「${report.subject}」群聊记录 ${report.period.start} ~ ${report.period.end}　｜　${report.generator?.skill ?? 'chat-report'}（${report.generator?.model ?? '模型未记录'}）${(report.generatedAt || '').slice(0, 10)}`, size: 16, color: SUB })] }));

  const doc = new Document({
    creator: 'AI Community · 聊天记录 → 报告',
    title: report.title,
    styles: { default: { document: { run: { font: { ascii: 'Arial', eastAsia: 'Microsoft YaHei', hAnsi: 'Arial' }, size: 21, color: INK } } } },
    sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children: body }],
  });
  return Packer.toBuffer(doc);
}

/** 下载文件名（Content-Disposition 用；路径分隔符与引号去掉）。 */
export function reportExportFilename(report: Report, ext: 'docx' | 'pdf'): string {
  const base = `${report.subject || '报告'}_${report.period.start}_${report.period.end}_${KIND_LABEL[report.kind] ?? '报告'}`.replace(/[\\/:*?"<>|]+/g, '_');
  return `${base}.${ext}`;
}
