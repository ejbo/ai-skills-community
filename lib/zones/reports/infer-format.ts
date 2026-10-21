// 解析器兜底：所有确定性解析器都认不出记录时，让模型看文件开头，推断「一条消息的行头长什么样」，
// 给出一个带命名分组的正则（date / time / name / account）+ 可选日头正则；我们用它确定性地切分全文，
// 并校验（样本里至少匹配 8 行、时间能解析），不行就放弃——模型只负责"看格式"，不碰内容。
// （owner：「这里面不是也有 ai 介入吗？为什么对文件这么严格」）

import { z } from 'zod';
import { callJson } from './llm';
import { parseLocalTime } from './parse';

const specSchema = z.object({
  lineRegex: z.string().min(4).max(400),
  dayRegex: z.string().max(200).nullable().default(null),
  note: z.string().max(200).optional(),
});
export type LineFormatSpec = z.infer<typeof specSchema>;

const PROMPT = (sample: string) => `下面是一份群聊记录文件的开头（可能是 agent 自己导出的格式）。请找出"每条消息的第一行（行头）"的格式，写一个 JavaScript 正则：
- 必须包含命名分组 (?<name>…) 和 (?<account>…)；时间用 (?<date>YYYY-MM-DD HH:mm:ss 之类) 或者（当日期在单独的日头行时）(?<time>HH:mm:ss)。
- 如果日期在单独一行（如 "#### 2026-09-20 ####"），再给一个 dayRegex，命名分组 (?<date>…)。
- 行头正则会逐行用 ^…$ 匹配，不要写 g / m 标志，不要用回溯爆炸的写法。
- 只输出一个 JSON 对象：{"lineRegex":"…","dayRegex":"…或 null","note":"一句话说明"}。

文件开头：
${sample}`;

/** 返回 null = 模型给不出可用的格式。 */
export async function inferLineFormat(text: string): Promise<LineFormatSpec | null> {
  const lines = text.split(/\r?\n/);
  const sample = lines.slice(0, 80).join('\n').slice(0, 6000);
  let spec: LineFormatSpec;
  try {
    spec = (await callJson({ step: '推断记录格式', prompt: PROMPT(sample), schema: specSchema, maxTokens: 800, retries: 1 })).value;
  } catch {
    return null;
  }
  const compiled = compile(spec);
  if (!compiled) return null;
  const hits = countHits(lines.slice(0, 400), compiled);
  return hits >= 8 ? spec : null;
}

function compile(spec: LineFormatSpec): { line: RegExp; day: RegExp | null } | null {
  try {
    const line = new RegExp(spec.lineRegex.replace(/^\^?/, '^').replace(/\$?$/, '$'));
    if (!/\(\?<name>/.test(spec.lineRegex) || !/\(\?<account>/.test(spec.lineRegex)) return null;
    if (!/\(\?<date>/.test(spec.lineRegex) && !/\(\?<time>/.test(spec.lineRegex)) return null;
    const day = spec.dayRegex ? new RegExp(spec.dayRegex) : null;
    return { line, day };
  } catch {
    return null;
  }
}

function countHits(lines: string[], c: { line: RegExp; day: RegExp | null }): number {
  let day: string | null = null;
  let n = 0;
  for (const l of lines) {
    if (l.length > 2000) continue;
    const dm = c.day?.exec(l);
    if (dm?.groups?.date) {
      day = dm.groups.date;
      continue;
    }
    const m = c.line.exec(l);
    if (!m?.groups) continue;
    const stamp = m.groups.date ?? (day && m.groups.time ? `${day} ${m.groups.time}` : null);
    if (stamp && parseLocalTime(stamp)) n++;
  }
  return n;
}

/** 用推断出的格式把全文切成 RawMessage 形状的数组（和 parse.ts 的 TXT 版式一致的输出）。 */
export function splitWithSpec(text: string, spec: LineFormatSpec): { msgId: null; ts: number; account: string; name: string; contentType: null; content: string }[] {
  const c = compile(spec);
  if (!c) return [];
  const out: { msgId: null; ts: number; account: string; name: string; contentType: null; content: string }[] = [];
  let day: string | null = null;
  let cur: { ts: number; account: string; name: string; lines: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    out.push({ msgId: null, ts: cur.ts, account: cur.account.toLowerCase(), name: cur.name.trim(), contentType: null, content: cur.lines.join('\n').trim() });
    cur = null;
  };
  for (const l of text.split(/\r?\n/)) {
    if (l.length <= 2000) {
      const dm = c.day?.exec(l);
      if (dm?.groups?.date) {
        day = dm.groups.date;
        continue;
      }
      const m = c.line.exec(l);
      if (m?.groups) {
        const stamp = m.groups.date ?? (day && m.groups.time ? `${day} ${m.groups.time}` : null);
        const d = stamp ? parseLocalTime(stamp) : null;
        if (d) {
          flush();
          cur = { ts: d.getTime(), account: m.groups.account ?? '', name: m.groups.name ?? '', lines: [] };
          continue;
        }
      }
    }
    if (cur) cur.lines.push(l);
  }
  flush();
  return out;
}
