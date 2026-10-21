// 模型兜底（lib/zones/reports/infer-format.ts）：模型只给"行头长什么样"的正则，切分与校验都是我们确定性做的。
// 这里 mock 掉 callJson，钉住的是：校验（命中 ≥ 8 行、时间能解析、必须有 name/account 分组）、切分结果、不合格就返回 null。
import { describe, expect, it, vi } from 'vitest';

const answer = vi.hoisted(() => ({ value: {} as Record<string, unknown>, fail: false }));
vi.mock('@/lib/zones/reports/llm', () => ({
  callJson: vi.fn(async () => {
    if (answer.fail) throw new Error('llm down');
    return { value: answer.value, warnings: [], attempts: 1 };
  }),
}));

import { inferLineFormat, splitWithSpec } from '@/lib/zones/reports/infer-format';

// agent 自己发明的一种格式：`>> 07:08:22 李思昊 <l00974474>`，日期在 `== 2026-09-20 ==` 日头里
const DAY = (d: string) => `== ${d} ==`;
const LINE = (t: string, n: string, a: string, body: string) => `>> ${t} ${n} <${a}>\n${body}`;
const text = [
  '加研思想院 记录',
  DAY('2026-09-20'),
  ...Array.from({ length: 6 }, (_, i) => LINE(`07:0${i}:00`, '李思昊', 'l00974474', `第 ${i + 1} 条\n第二行`)),
  DAY('2026-09-21'),
  ...Array.from({ length: 5 }, (_, i) => LINE(`08:1${i}:00`, '白东峰', 'b00580378', `次日 ${i + 1}`)),
].join('\n');

const GOOD = { lineRegex: String.raw`^>> (?<time>\d{2}:\d{2}:\d{2}) (?<name>\S+) <(?<account>[a-z]\d+)>$`, dayRegex: String.raw`^== (?<date>\d{4}-\d{2}-\d{2}) ==$`, note: '>> 时间 姓名 <账号>' };

describe('inferLineFormat', () => {
  it('accepts a spec that matches ≥ 8 sample lines with parseable times', async () => {
    answer.value = GOOD;
    answer.fail = false;
    expect(await inferLineFormat(text)).toMatchObject({ lineRegex: GOOD.lineRegex });
  });

  it('rejects specs without name/account groups, without a time, that match too few lines, or that do not compile', async () => {
    for (const bad of [
      { lineRegex: String.raw`^>> (?<time>\d{2}:\d{2}:\d{2}) (?<name>\S+)`, dayRegex: GOOD.dayRegex },
      { lineRegex: String.raw`^>> (?<name>\S+) <(?<account>\w+)>`, dayRegex: null },
      { lineRegex: String.raw`^>> (?<time>\d{2}:\d{2}:\d{2}) (?<name>\S+) <(?<account>[a-z]\d+)>$`, dayRegex: null }, // 没日头 → 时间拼不出日期
      { lineRegex: String.raw`^(?<time>99:99:99) (?<name>\S+) <(?<account>\w+)>`, dayRegex: GOOD.dayRegex }, // 命中 0 行
      { lineRegex: String.raw`^(?<time>(\d{2}:\d{2}:\d{2}) (?<name>\S+) <(?<account>\w+)>`, dayRegex: null }, // 括号不配
    ]) {
      answer.value = bad;
      expect(await inferLineFormat(text)).toBeNull();
    }
    answer.fail = true;
    expect(await inferLineFormat(text)).toBeNull();
  });
});

describe('splitWithSpec', () => {
  it('splits the whole text deterministically with the inferred spec', () => {
    const raw = splitWithSpec(text, GOOD);
    expect(raw).toHaveLength(11);
    expect(raw[0]).toMatchObject({ account: 'l00974474', name: '李思昊', content: '第 1 条\n第二行' });
    expect(new Date(raw[0].ts).getDate()).toBe(20);
    expect(new Date(raw[6].ts).getDate()).toBe(21);
    expect(raw[10]).toMatchObject({ account: 'b00580378', content: '次日 5' });
  });
});
