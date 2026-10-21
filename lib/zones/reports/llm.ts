// 版块报告 — 一次「要 JSON 的模型调用」：complete(json) → 解析（坏 JSON 先修）→ coerce（收，不拒）→ zod → 引用校验，
// 失败把错误原样贴回模型重试；重试用尽时交给 onExhausted 兜底（coerce.ts），能兜住就不抛错，只记 warning。
// （owner 2026-10-20：「如果 json 一直会出问题，就不要用，我需要的是一致性和可靠性」）

import type { z } from 'zod';
import { parseModelJson } from './model-json';
import { getReportProvider } from './provider';
import type { LLMMessage, LLMProvider } from '@/lib/llm';
import { REPORT_SYSTEM_PROMPT } from './prompts';
import { zodIssues, type Validation } from './schema';

export { parseModelJson } from './model-json';

export class ReportLlmError extends Error {
  constructor(
    message: string,
    public readonly step: string,
    public readonly lastReply: string | null,
  ) {
    super(message);
    this.name = 'ReportLlmError';
  }
}

export interface CallJsonOptions<T> {
  step: string;
  prompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** 引用校验：返回 errors 非空则重试。 */
  validate?: (value: T) => Validation;
  maxTokens?: number;
  retries?: number;
  provider?: LLMProvider;
  signal?: AbortSignal;
  /** 每次尝试后的回调（记录警告 / 进度）。 */
  onAttempt?: (info: { attempt: number; ok: boolean; problem?: string; warnings?: string[] }) => void;
  /** 过 zod 之前先规范化（coerce.ts）：修 id / 键名 / 超长 / 枚举 / 无效引用；返回的 warnings 会并进结果。 */
  coerce?: (raw: unknown) => { value: unknown; warnings: string[] };
  /**
   * 重试用尽后的兜底：value = 最后一次过了 zod 的值（只是引用校验不过）或 null（连形状都没对上）。
   * 返回非 null 就当成功（warnings 里记一条「已兜底」），返回 null 才抛 ReportLlmError。
   */
  onExhausted?: (last: { value: T | null; problem: string }) => T | null;
}

export async function callJson<T>(opts: CallJsonOptions<T>): Promise<{ value: T; warnings: string[]; attempts: number }> {
  const provider = opts.provider ?? (await getReportProvider()).provider;
  const retries = opts.retries ?? 2;
  const messages: LLMMessage[] = [{ role: 'user', content: opts.prompt }];
  let attempt = 0;
  let lastReply: string | null = null;
  let lastValue: T | null = null;
  for (;;) {
    attempt++;
    const out = await provider.complete({
      system: REPORT_SYSTEM_PROMPT,
      messages,
      maxTokens: opts.maxTokens ?? 8000,
      json: true,
      signal: opts.signal,
    });
    lastReply = out.text;
    let problem: string | null = null;
    let warnings: string[] = [];
    let value: T | null = null;
    const obj = parseModelJson(out.text);
    if (obj === null) {
      problem =
        out.finishReason === 'length' || out.finishReason === 'max_tokens'
          ? '你的输出被截断了（超过长度上限）。请压缩每条 text 的长度、减少观点条数，重新输出完整的 JSON 对象。'
          : '你的输出不是合法 JSON。请只输出一个 JSON 对象，不要注释、不要尾逗号、字符串内引号要转义。';
    } else {
      let shaped: unknown = obj;
      if (opts.coerce) {
        const c = opts.coerce(obj);
        shaped = c.value;
        warnings.push(...c.warnings);
      }
      const parsed = opts.schema.safeParse(shaped);
      if (!parsed.success) {
        problem = `JSON 形状不符合要求，请修正后重新输出完整 JSON（保留所有正确的部分）：\n${zodIssues(parsed.error).join('\n')}`;
      } else {
        value = parsed.data;
        lastValue = parsed.data;
        const v = opts.validate?.(parsed.data);
        if (v) {
          warnings.push(...v.warnings);
          if (v.errors.length) problem = `校验器指出以下问题，请修正后重新输出完整 JSON（保留所有正确的部分）：\n${v.errors.map((e) => `✖ ${e}`).join('\n')}`;
        }
      }
    }
    opts.onAttempt?.({ attempt, ok: !problem, problem: problem ?? undefined, warnings });
    if (!problem && value !== null) return { value, warnings, attempts: attempt };
    if (attempt > retries) {
      const brief = (problem ?? '').split('\n').filter(Boolean).slice(0, 4).join('；');
      const rescued = opts.onExhausted?.({ value: lastValue, problem: problem ?? '' }) ?? null;
      if (rescued !== null) {
        return { value: rescued, warnings: [...warnings, `${opts.step}：模型 ${attempt} 次输出都没过校验（${brief}），已按规则兜底`], attempts: attempt };
      }
      throw new ReportLlmError(`${opts.step}：重试 ${retries} 次后仍有问题 — ${brief}`, opts.step, lastReply);
    }
    messages.push({ role: 'assistant', content: out.text });
    messages.push({ role: 'user', content: problem! });
  }
}
