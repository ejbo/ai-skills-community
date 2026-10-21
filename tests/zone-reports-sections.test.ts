// 报告原生视图的目录与「看原文」id 解析（lib/zones/reports/sections.ts, messages.ts）。
// 钉住：目录顺序 要点 → 专题（id = 主题 id）→ 活动 → Recap → 资料 → 数据；ids 只认 m\d+、去重、封顶。
import { describe, expect, it, vi } from 'vitest';

// messages.ts 带着 prisma（getReportMessages）；这里只测纯函数。
vi.mock('@/lib/db', () => ({ prisma: {} }));
import { REPORT_SECTION_IDS, reportHeadings } from '@/lib/zones/reports/sections';
import { MAX_MESSAGE_IDS, parseMessageIds } from '@/lib/zones/reports/messages';
import type { Report } from '@/lib/zones/reports/schema';

const base = {
  schemaVersion: 1 as const,
  kind: 'weekly' as const,
  title: 'T',
  subject: 'G',
  period: { start: '2026-09-01', end: '2026-09-07', label: '' },
  generatedAt: '',
  generator: { skill: 'chat-report', version: '', model: null },
  summary: { headline: '', highlights: [], judgments: [], actions: [] },
  attachments: [],
  stats: { messages: 0, substantive: 0, speakers: 0, activeDays: 0, peakDay: { date: '', count: 0 }, byType: {}, byDay: [], bySpeaker: [], links: 0, linkHosts: [], attachments: 0, attachmentPlaceholders: 0 },
  unassigned: [],
};
const theme = (id: string, title: string, withSource = false) => ({
  id,
  title,
  tagline: '',
  weight: 1,
  msgIds: [],
  macro: [],
  viewpoints: [{ id: `${id}-v1`, speaker: 'a', account: 'a1', date: '2026-09-01', dates: ['2026-09-01'], text: '', sources: withSource ? [{ label: 'x', url: 'https://x' }] : [], msgRefs: ['m1'], attachments: [] }],
  conclusion: null,
  openQuestions: [],
  resources: [],
});

describe('reportHeadings', () => {
  it('lists brief, every theme by its own id, then the optional sections in order', () => {
    const report: Report = { ...base, themes: [theme('t1', '决策模型', true), theme('t2', 'RSI')], recap: { title: '花絮', items: [{ id: 'r1', text: '', sources: [], msgRefs: [], attachments: [] }] }, events: [{ id: 'e1', title: 'x', date: null, host: null, url: null, note: null, msgRefs: [], attachments: [] }] };
    expect(reportHeadings(report).map((h) => h.id)).toEqual([REPORT_SECTION_IDS.brief, 't1', 't2', REPORT_SECTION_IDS.events, REPORT_SECTION_IDS.recap, REPORT_SECTION_IDS.resources, REPORT_SECTION_IDS.stats]);
    expect(reportHeadings(report)[1].text).toBe('01 决策模型');
  });
  it('skips events / recap / resources when the report has none', () => {
    const report: Report = { ...base, themes: [theme('t1', 'A')], recap: null, events: [] };
    expect(reportHeadings(report).map((h) => h.id)).toEqual([REPORT_SECTION_IDS.brief, 't1', REPORT_SECTION_IDS.stats]);
  });
});

describe('parseMessageIds', () => {
  it('accepts m-ids from a comma list or repeated params, dedupes, ignores junk, caps the count', () => {
    expect(parseMessageIds('m12,m3, m12 x m0001')).toEqual(['m12', 'm3', 'm0001']);
    expect(parseMessageIds(['m1', 'm2,m3'])).toEqual(['m1', 'm2', 'm3']);
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseMessageIds(Array.from({ length: 100 }, (_, i) => `m${i + 1}`).join(','))).toHaveLength(MAX_MESSAGE_IDS);
  });
});
