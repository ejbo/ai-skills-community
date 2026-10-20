// 版块报告 — report.json 契约与引用校验（lib/zones/reports/schema.ts）+ 装配 / 渲染（assemble.ts, render-md.ts）。
// 钉住：覆盖率 < 85% 是错误；编造的 url 是错误；发言人与 msgRefs 对不上是错误；
// 图片按「同消息 / 同人邻近」跟随观点；render-md 用 embed 令牌引用文件与知识库文档。
import { describe, expect, it } from 'vitest';
import { parseChat } from '@/lib/zones/reports/parse';
import { computeStats } from '@/lib/zones/reports/digest';
import {
  clusterSchema,
  overviewSchema,
  themeSchema,
  validateCluster,
  validateOverview,
  validateTheme,
  type ClusterResult,
  type ThemeResult,
} from '@/lib/zones/reports/schema';
import { assembleReport, guessKind } from '@/lib/zones/reports/assemble';
import { renderReportMarkdown, reportTags } from '@/lib/zones/reports/render-md';

const TXT = `[2026-09-20 07:08:22] 李思昊（l00974474）
Jev 引爆了决策模型这个类别 https://typesafe.ai/

[2026-09-20 07:08:40] 李思昊（l00974474）
[图片/附件]

[2026-09-20 07:09:00] 白东峰（b00580378）
这东西只能做选择题，最先落地 ToB

[2026-09-20 15:27:52] 白东峰（b00580378）
【邀您参加】RSI 洞见烩 https://2012labs.huawei.com/#/seminar/1

[2026-09-21 09:00:00] 周春华（z00885012）
iPhone 18 存储颗粒不一样，已实锤

[2026-09-21 09:01:00] 周春华（z00885012）
好的
`;

const manifest = [{ time: '2026-09-20 07:08', ts: new Date(2026, 8, 20, 7, 8, 0).getTime(), account: 'l00974474', name: '李思昊', kind: 'image' as const, file: 'jev.png', size: 1, url: '', code: '' }];
const chat = parseChat(TXT, { subject: 'G', manifest, presentFiles: new Set(['jev.png']) });

const cluster: ClusterResult = clusterSchema.parse({
  themes: [{ id: 't1', title: '决策模型', tagline: 'Jev', msgIds: ['m1', 'm3'] }],
  events: ['m4'],
  recap: ['m5'],
  skip: [],
});

const theme: ThemeResult = themeSchema.parse({
  id: 't1',
  title: '决策模型',
  tagline: 'Jev 引爆决策模型',
  macro: [{ tag: '分歧', text: '白东峰 vs 李思昊' }],
  viewpoints: [
    { speaker: '李思昊', account: 'l00974474', date: '2026-09-20', role: '提出', text: 'Jev 引爆了决策模型', sources: [{ label: 'typesafe.ai', url: 'https://typesafe.ai/' }], msgRefs: ['m1'] },
    { speaker: '白东峰', account: 'b00580378', date: '2026-09-20', role: '质疑', text: '只能做选择题', sources: [{ label: '群内观点' }], msgRefs: ['m3'] },
  ],
  conclusion: null,
  openQuestions: [],
  resources: [],
});

describe('validateCluster', () => {
  it('passes when every substantive message is placed', () => {
    const v = validateCluster(cluster, chat);
    expect(v.errors).toEqual([]);
  });
  it('fails on coverage < 85% and on unknown ids', () => {
    const v = validateCluster({ themes: [{ id: 't1', title: 'x', tagline: '', msgIds: ['m1', 'm99'] }], events: [], recap: [], skip: [] }, chat);
    expect(v.errors.some((e) => e.includes('m99'))).toBe(true);
    expect(v.errors.some((e) => e.includes('覆盖率'))).toBe(true);
  });
});

describe('validateTheme', () => {
  it('accepts a theme whose refs, speakers and urls all come from the record', () => {
    expect(validateTheme(theme, chat, cluster).errors).toEqual([]);
  });
  it('rejects a fabricated url', () => {
    const bad = { ...theme, viewpoints: [{ ...theme.viewpoints[0], sources: [{ label: 'x', url: 'https://example.com/made-up' }] }] };
    expect(validateTheme(bad, chat, cluster).errors.some((e) => e.includes('禁止编造链接'))).toBe(true);
  });
  it('rejects a viewpoint whose msgRefs were all sent by someone else', () => {
    const bad = { ...theme, viewpoints: [{ ...theme.viewpoints[0], account: 'b00580378', speaker: '白东峰' }] };
    expect(validateTheme(bad, chat, cluster).errors.some((e) => e.includes('没有一条是'))).toBe(true);
  });
  it('rejects an unknown account and a non-existent message', () => {
    const bad = { ...theme, viewpoints: [{ ...theme.viewpoints[0], account: 'x00000000', msgRefs: ['m42'] }] };
    const v = validateTheme(bad, chat, cluster);
    expect(v.errors.some((e) => e.includes('不在发言人名单'))).toBe(true);
    expect(v.errors.some((e) => e.includes('不存在的消息'))).toBe(true);
  });
  it('zod rejects a macro tag or role outside the vocabulary', () => {
    expect(themeSchema.safeParse({ ...theme, macro: [{ tag: '总结', text: 'x' }] }).success).toBe(false);
    expect(themeSchema.safeParse({ ...theme, viewpoints: [{ ...theme.viewpoints[0], role: '风险' }] }).success).toBe(false);
  });
});

describe('overview', () => {
  const overview = overviewSchema.parse({
    headline: '决策模型进入评估阶段',
    highlights: [{ text: 'a', themeId: 't1' }, { text: 'b' }],
    judgments: [{ text: 'c', themeId: 't1', confidence: 'high' }],
    actions: [{ text: 'd', owner: '周春华', ownerAccount: 'Z00885012', themeId: null }],
  });
  it('validates themeIds against the real themes', () => {
    expect(validateOverview(overview, new Set(['t1'])).errors).toEqual([]);
    expect(validateOverview({ ...overview, highlights: [{ text: 'a', themeId: 't9' }] }, new Set(['t1'])).errors).toHaveLength(1);
  });

  describe('assemble + render', () => {
    const report = assembleReport({
      chat,
      stats: computeStats(chat),
      cluster,
      themes: [theme],
      recap: { recap: { title: '非科研 · 快速 Recap', items: [{ text: 'iPhone 存储颗粒', msgRefs: ['m5'], sources: [] }] }, events: [{ title: 'RSI 洞见烩', date: '2026-09-20', host: '白东峰', url: 'https://2012labs.huawei.com/#/seminar/1', note: null, msgRefs: ['m4'] }] },
      overview,
      kind: 'weekly',
      title: 'G · 周报',
      assetKeys: new Map([['jev.png', 'image/abc.png']]),
    });

    it('follows the image sent right after the viewpoint message and lowercases accounts', () => {
      const v = report.themes[0].viewpoints[0];
      expect(v.id).toBe('t1-v1');
      expect(v.attachments).toHaveLength(1);
      const att = report.attachments.find((a) => a.id === v.attachments[0])!;
      expect(att).toMatchObject({ file: 'jev.png', assetKey: 'image/abc.png', placement: { kind: 'viewpoint', id: 't1-v1' } });
      expect(report.summary.actions[0].ownerAccount).toBe('z00885012');
      expect(report.unassigned).toEqual([]);
      expect(report.events[0].id).toBe('e1');
      expect(report.recap?.items[0].speaker).toBe('周春华');
    });

    it('renders markdown with the brief, the theme timeline, the image and the events table', () => {
      const md = renderReportMarkdown(report, { librarySlugs: new Map() });
      expect(md).toContain('> **一句话** 决策模型进入评估阶段');
      expect(md).toContain('## 01 · 决策模型');
      expect(md).toContain('**09-20 · 李思昊**（提出）：Jev 引爆了决策模型 — 来源：[typesafe.ai](https://typesafe.ai/)');
      expect(md).toContain('![jev.png](/api/zones/media/image/abc.png)');
      expect(md).toContain('| 2026-09-20 | [RSI 洞见烩](https://2012labs.huawei.com/#/seminar/1) | 白东峰 |');
      expect(md).toContain('## 非科研 · 快速 Recap');
      expect(md).not.toContain('## 数据概览');
    });

    it('uses a library embed when the attachment was ingested, a file embed otherwise', () => {
      const withDoc = assembleReport({
        chat,
        stats: computeStats(chat),
        cluster,
        themes: [theme],
        recap: null,
        overview,
        assetKeys: new Map([['jev.png', 'file/abc.pdf']]),
      });
      withDoc.attachments[0].kind = 'file';
      withDoc.attachments[0].file = 'jev.pdf';
      expect(renderReportMarkdown(withDoc, { librarySlugs: new Map([['jev.pdf', 'jev-paper']]) })).toContain('[embed:library:jev-paper]');
      expect(renderReportMarkdown(withDoc, { includeStats: true })).toContain('[embed:file:file/abc.pdf]');
      expect(renderReportMarkdown(withDoc, { includeStats: true })).toContain('## 数据概览');
    });

    it('derives kind and tags', () => {
      expect(guessKind('2026-09-01', '2026-09-30')).toBe('monthly');
      expect(guessKind('2026-09-01', '2026-09-07')).toBe('weekly');
      expect(reportTags(report)).toEqual(['决策模型']);
    });
  });
});
