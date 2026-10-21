// 模型输出的「收，不拒」层（lib/zones/reports/coerce.ts）。owner 2026-10-20：「怎么还是有这种问题，如果 json 一直会出问题，
// 就不要用，我需要的是一致性和可靠性」。这里钉住的是：模型把 id 写成数字 / 键名换叫法 / 超长 / 枚举写英文 / 引用不存在的
// 消息 / 发言人写错，都不再是 ✖；coerce 后过 zod 一定通过；重试用尽时 autofix / fallback 一定给出能过 zod + 引用校验的值。
import { describe, expect, it } from 'vitest';
import { autofixCluster, clip, coerceCluster, coerceDate, coerceEnum, coerceImportedReport, coerceMsgIds, coerceOverview, coerceRecap, coerceTheme, coerceThemeId, fallbackCluster, fallbackOverview, fallbackRecap, fallbackTheme } from '@/lib/zones/reports/coerce';
import { parseModelJson } from '@/lib/zones/reports/model-json';
import { parseChat } from '@/lib/zones/reports/parse';
import { clusterSchema, indexChat, MACRO_TAGS, overviewSchema, recapSchema, reportSchema, themeSchema, validateCluster, validateOverview, validateRecap, validateTheme } from '@/lib/zones/reports/schema';

const TXT = `[2026-09-20 08:56:39] 李思昊(l00974474) <文本>
如果多智能体都是这种方式，也能节省很多 tokens 内存开销
[2026-09-20 09:10:00] 白东峰(b00580378) <文本>
Jev 的 harness 设计值得看 https://typesafe.ai/
[2026-09-20 09:12:00] 白东峰(b00580378) <文本>
我们内部也可以试一下
[2026-09-21 10:00:00] 周春华(z00885012) <文本>
MicroLED 玻璃基板今年量产
[2026-09-21 10:05:00] 李思昊(l00974474) <文本>
玻璃基板的良率还是问题 https://arxiv.org/abs/2509.00001
[2026-09-22 11:00:00] 周春华(z00885012) <文本>
下周四洞见烩，主题是推理系统，大家报名
[2026-09-22 11:30:00] 白东峰(b00580378) <文本>
iPhone 18 Pro 的存储颗粒换了
[2026-09-23 08:00:00] 李思昊(l00974474) <文本>
👍
[2026-09-23 09:00:00] 周春华(z00885012) <文本>
H20 出口许可又变了
[2026-09-23 09:30:00] 白东峰(b00580378) <文本>
这对国内推理集群采购影响很大
`;
const chat = parseChat(TXT);
const index = indexChat(chat);
const msgs = chat.messages.map((m) => m.id);

describe('primitives', () => {
  it('coerceMsgIds accepts numbers, bare digits, prefixes, ranges and comma-joined strings', () => {
    expect(coerceMsgIds([1, '2', '#3', 'M4', 'msg5', 'm 6', 'm7-m9', 'm10, m11'])).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11']);
    expect(coerceMsgIds('m3')).toEqual(['m3']);
    expect(coerceMsgIds([{ id: 'm2' }, { msgId: 4 }])).toEqual(['m2', 'm4']);
    expect(coerceMsgIds(['abc', null, 'm1-m900'])).toEqual([]); // 乱写 / 过大的区间不展开
  });
  it('coerceThemeId / coerceEnum / coerceDate / clip', () => {
    expect(['t1', 'T1', 'theme1', 'theme_01', 1, '主题1'].map((v) => coerceThemeId(v, 7))).toEqual(['t1', 't1', 't1', 't1', 't1', 't1']);
    expect(coerceThemeId('whatever', 7)).toBe('t8');
    expect(coerceEnum('Consensus', MACRO_TAGS, { consensus: '共识' })).toBe('共识');
    expect(coerceEnum(' 风险 ', MACRO_TAGS)).toBe('风险');
    expect(coerceEnum('nonsense', MACRO_TAGS)).toBeUndefined();
    expect(coerceDate('2026/9/20 07:08')).toBe('2026-09-20');
    expect(coerceDate('2026年10月1日')).toBe('2026-10-01');
    expect(coerceDate('下周')).toBeNull();
    expect(clip('  a   b  ', 10)).toBe('a b');
    expect(clip('x'.repeat(100), 10)).toHaveLength(10);
    expect(clip(['a', 'b'], 10)).toBe('a；b');
    expect(clip({ text: 'nested' }, 10)).toBe('nested');
  });
  it('parseModelJson repairs trailing commas, comments, single quotes, fences, truncation and accepts arrays', () => {
    expect(parseModelJson('```json\n{"themes":[{"id":"t1",},],}\n```')).toEqual({ themes: [{ id: 't1' }] });
    expect(parseModelJson("好的，结果如下：\n{themes: [{id: 't1', title: 'a'}], // 注释\n}")).toEqual({ themes: [{ id: 't1', title: 'a' }] });
    expect(parseModelJson('{"themes":[{"id":"t1","title":"被截断了')).toEqual({ themes: [{ id: 't1', title: '被截断了' }] });
    expect(parseModelJson('[{"id":"t1"}]')).toEqual([{ id: 't1' }]);
    expect(parseModelJson('完全不是 json')).toBeNull();
  });
});

describe('coerceCluster', () => {
  it('turns a sloppy cluster into one that passes zod and the reference check', () => {
    const sloppy = {
      topics: [
        { id: 1, name: 'Agent harness 与多智能体的内存开销——这是一个很长很长很长很长很长很长很长很长很长很长很长很长的标题', summary: 'x', messages: [1, 2, 3, 'm99'] },
        { id: 'T2', title: '封装：MicroLED、玻璃基板', msgIds: 'm4, m5' },
        { title: '算力格局', msgIds: ['m9-m10', 'm4'] }, // 没 id；m4 重复 → 以先出现者为准
      ],
      activities: ['6'],
      other: [7],
      noise: ['m8'],
    };
    const { value, warnings } = coerceCluster(sloppy, chat);
    const parsed = clusterSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    const c = parsed.success ? parsed.data : null!;
    expect(c.themes.map((t) => [t.id, t.msgIds])).toEqual([
      ['t1', ['m1', 'm2', 'm3']],
      ['t2', ['m4', 'm5']],
      ['t3', ['m9', 'm10']],
    ]);
    expect(c.themes[0].title.length).toBeLessThanOrEqual(60);
    expect(c.events).toEqual(['m6']);
    expect(c.recap).toEqual(['m7']);
    expect(c.skip).toEqual(['m8']);
    expect(validateCluster(c, chat).errors).toEqual([]);
    expect(warnings.join(' ')).toContain('不存在的消息');
  });
  it('accepts a bare array / a map of themes, caps at 12 themes, drops empty ones', () => {
    expect(clusterSchema.safeParse(coerceCluster([{ title: 'a', ids: [1] }], chat).value).success).toBe(true);
    expect(clusterSchema.safeParse(coerceCluster({ t1: { title: 'a', msgIds: [1] }, t2: { title: 'b', msgIds: [] } }, chat).value).success).toBe(true);
    const many = { themes: msgs.map((id, i) => ({ id: `t${i + 1}`, title: `主题${i}`, msgIds: [id] })) };
    const { value } = coerceCluster(many, chat);
    const c = clusterSchema.parse(value);
    expect(c.themes).toHaveLength(10); // 只有 10 条消息 → 10 个主题；超过 12 时才裁
    expect(clusterSchema.safeParse(coerceCluster({ themes: [] }, chat).value).success).toBe(false); // 一个主题都没有 → zod 不过 → 让 onExhausted 兜底
  });
  it('autofixCluster covers the leftovers; fallbackCluster groups by day and always validates', () => {
    const thin = clusterSchema.parse({ themes: [{ id: 't1', title: 'a', msgIds: ['m1'] }], events: [], recap: [], skip: [] });
    expect(validateCluster(thin, chat).errors.length).toBeGreaterThan(0);
    const fixed = autofixCluster(thin, chat);
    expect(validateCluster(fixed, chat).errors).toEqual([]);
    expect(fixed.themes.at(-1)?.title).toBe('其他讨论');
    const fb = fallbackCluster(chat);
    expect(clusterSchema.safeParse(fb).success).toBe(true);
    expect(validateCluster(fb, chat).errors).toEqual([]);
    expect(fb.themes.map((t) => t.title)).toEqual(['09-20 的讨论', '09-21 的讨论', '09-22 的讨论', '09-23 的讨论']);
  });
});

describe('coerceTheme', () => {
  const t = { id: 't1', title: 'Agent harness', tagline: '', msgIds: ['m1', 'm2', 'm3'] };
  it('fixes speakers from the referenced messages, drops fabricated urls, maps english tags and roles', () => {
    const sloppy = {
      macro: [{ tag: 'consensus', text: '大家都觉得 harness 重要' }, 'risk: 内存开销'],
      timeline: [
        { who: '张三', account: 'nobody', date: '2026/9/20', role: 'propose', text: 'x'.repeat(500), refs: [1] },
        { speaker: '白东峰', date: 'bad', text: 'Jev 值得看', sources: [{ title: 'typesafe', url: 'https://typesafe.ai/' }, { label: '编的', url: 'https://fake.example' }], msgRefs: ['m2', 'm3', 'm77'] },
        { speaker: '没有引用', text: 'x', msgRefs: [] },
      ],
      resources: [{ url: 'https://typesafe.ai/', kind: 'blog' }, { url: 'https://fake.example' }],
      questions: ['还有多少开销？'],
    };
    const { value, warnings } = coerceTheme(sloppy, chat, t, index);
    const parsed = themeSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    const th = parsed.success ? parsed.data : null!;
    expect(th.macro.map((m) => m.tag)).toEqual(['共识', '判断']);
    expect(th.viewpoints).toHaveLength(2);
    expect(th.viewpoints[0]).toMatchObject({ speaker: '李思昊', account: 'l00974474', date: '2026-09-20', role: '提出' });
    expect(th.viewpoints[0].text.length).toBeLessThanOrEqual(400);
    expect(th.viewpoints[1]).toMatchObject({ account: 'b00580378', date: '2026-09-20', msgRefs: ['m2', 'm3'] });
    expect(th.viewpoints[1].sources).toEqual([{ label: 'typesafe', url: 'https://typesafe.ai/' }, { label: '编的', url: null }]);
    expect(th.resources).toEqual([{ label: 'typesafe.ai/', url: 'https://typesafe.ai/', kind: 'article' }]);
    expect(th.openQuestions).toEqual(['还有多少开销？']);
    expect(validateTheme(th, chat, null, index).errors).toEqual([]);
    expect(warnings.some((w) => w.includes('发言人'))).toBe(true);
  });
  it('fallbackTheme builds a plain theme from the messages that passes everything', () => {
    const fb = fallbackTheme(t, chat, index);
    expect(themeSchema.safeParse(fb).success).toBe(true);
    expect(validateTheme(fb, chat, null, index).errors).toEqual([]);
    expect(fb.viewpoints.map((v) => v.msgRefs)).toEqual([['m1'], ['m2', 'm3']]); // 同人 15 分钟内合并
    expect(fb.resources.map((r) => r.url)).toEqual(['https://typesafe.ai/']);
  });
});

describe('coerceRecap / coerceOverview / import', () => {
  it('recap: bare arrays, alias keys, invalid refs dropped; fallback from ids', () => {
    const { value } = coerceRecap({ recap: [{ text: 'iPhone 存储颗粒', refs: [7, 99] }], activities: [{ name: '洞见烩：推理系统', when: '2026-09-25', msgRefs: ['m6'], url: 'https://not-in-chat.example' }] }, chat, index);
    const r = recapSchema.parse(value);
    expect(r.recap?.items).toEqual([{ text: 'iPhone 存储颗粒', msgRefs: ['m7'], sources: [] }]);
    expect(r.events[0]).toMatchObject({ title: '洞见烩：推理系统', date: '2026-09-25', url: null });
    expect(validateRecap(r, chat, index).errors).toEqual([]);
    const fb = fallbackRecap(['m6'], ['m7'], chat, index);
    expect(recapSchema.safeParse(fb).success).toBe(true);
    expect(fb.events[0].title).toContain('洞见烩');
  });
  it('overview: strings as pointers, theme titles as themeId, chinese confidence, padded highlights', () => {
    const themes = [
      { id: 't1', title: 'Agent harness', tagline: '多智能体的内存开销', conclusion: 'harness 是关键' },
      { id: 't2', title: '封装', tagline: '玻璃基板量产' },
    ];
    const { value } = coerceOverview({ title: '本期一句话', keyPoints: ['只有一条'], conclusions: [{ text: '判断', theme: 'Agent harness', confidence: '高' }], todos: [{ text: '跟进', themeId: 't9' }] }, themes);
    const o = overviewSchema.parse(value);
    expect(o.headline).toBe('本期一句话');
    expect(o.highlights).toHaveLength(3); // 1 条模型给的 + 2 个主题定位
    expect(o.judgments[0]).toMatchObject({ themeId: 't1', confidence: 'high' });
    expect(o.actions[0].themeId).toBeNull();
    expect(validateOverview(o, new Set(['t1', 't2'])).errors).toEqual([]);
    expect(overviewSchema.safeParse(fallbackOverview(themes)).success).toBe(true);
    expect(overviewSchema.safeParse(coerceOverview(null, themes).value).success).toBe(true);
  });
  it('imported report.json: kind alias, missing period, numeric theme ids, summary rebuilt', () => {
    const { value } = coerceImportedReport({ kind: '月报', title: '', subject: '加研思想院', themes: [{ id: 1, title: 'A', tagline: 'a', viewpoints: [{ date: '2026-09-20' }, { date: '2026-10-19' }] }], summary: { headline: 'h' } });
    const parsed = reportSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    const r = parsed.success ? parsed.data : null!;
    expect(r.kind).toBe('monthly');
    expect(r.period).toMatchObject({ start: '2026-09-20', end: '2026-10-19' });
    expect(r.title).toBe('加研思想院 报告');
    expect((r.themes[0] as { id: string }).id).toBe('t1');
    expect(r.summary.highlights.length).toBeGreaterThanOrEqual(2);
  });
});
