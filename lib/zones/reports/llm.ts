// 版块报告 — 一次「要 JSON 的模型调用」：complete(json) → 解析 → zod → 引用校验，
// 失败把错误原样贴回模型重试（与 skill scripts/llm.mjs 同策略）。

import type { z } from 'zod';
import { getLibraryProvider } from '@/lib/library/llm';
import { extractJsonObject } from '@/lib/skill-assist';
import type { LLMMessage, LLMProvider } from '@/lib/llm';
import { REPORT_SYSTEM_PROMPT } from './prompts';
import { zodIssues, type Validation } from './schema';

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
}

/** 模型 JSON 的宽松解析：围栏、前后废话、全角引号都交给 extractJsonObject。 */
export function parseModelJson(text: string): Record<string, unknown> | null {
  const obj = extractJsonObject(text);
  if (obj) return obj;
  let t = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```\s*$/i.exec(t);
  if (fence) t = fence[1].trim();
  try {
    const parsed = JSON.parse(t) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function callJson<T>(opts: CallJsonOptions<T>): Promise<{ value: T; warnings: string[]; attempts: number }> {
  const provider = opts.provider ?? (await getLibraryProvider()).provider;
  const retries = opts.retries ?? 2;
  const messages: LLMMessage[] = [{ role: 'user', content: opts.prompt }];
  let attempt = 0;
  let lastReply: string | null = null;
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
    if (!obj) {
      problem =
        out.finishReason === 'length' || out.finishReason === 'max_tokens'
          ? '你的输出被截断了（超过长度上限）。请压缩每条 text 的长度、减少观点条数，重新输出完整的 JSON 对象。'
          : '你的输出不是合法 JSON。请只输出一个 JSON 对象，不要注释、不要尾逗号、字符串内引号要转义。';
    } else {
      const parsed = opts.schema.safeParse(obj);
      if (!parsed.success) {
        problem = `JSON 形状不符合要求，请修正后重新输出完整 JSON（保留所有正确的部分）：\n${zodIssues(parsed.error).join('\n')}`;
      } else {
        value = parsed.data;
        const v = opts.validate?.(parsed.data);
        if (v) {
          warnings = v.warnings;
          if (v.errors.length) problem = `校验器指出以下问题，请修正后重新输出完整 JSON（保留所有正确的部分）：\n${v.errors.map((e) => `✖ ${e}`).join('\n')}`;
        }
      }
    }
    opts.onAttempt?.({ attempt, ok: !problem, problem: problem ?? undefined, warnings });
    if (!problem && value !== null) return { value, warnings, attempts: attempt };
    if (attempt > retries) throw new ReportLlmError(`${opts.step}：重试 ${retries} 次后仍有问题 — ${problem?.split('\n')[0] ?? ''}`, opts.step, lastReply);
    messages.push({ role: 'assistant', content: out.text });
    messages.push({ role: 'user', content: problem! });
  }
}
