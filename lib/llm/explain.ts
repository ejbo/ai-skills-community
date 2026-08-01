// Turning a failed "the model must reply with JSON" call into something an
// operator can act on. Shared by the 知识库 indexer and the skill assist route:
// both used to collapse three different problems into one opaque message.

import type { LLMCompletion } from './types';

/**
 * A short, log-safe excerpt of what the model actually replied. An unterminated
 * `<think>` block (a reasoning model cut off by maxTokens) is the usual cause of
 * a JSON parse failure, and it is invisible unless the reply itself is shown.
 */
export function modelReplySample(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '（空响应）';
  const flat = trimmed.replace(/\s+/g, ' ');
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

/** The subset of LLMCompletion the explainer needs. */
export type ReplyShape = Pick<LLMCompletion, 'text' | 'finishReason' | 'reasoning'>;

/**
 * "模型没有按要求返回 JSON" is three different problems wearing one message.
 * Separate them, because the fix differs: raise the budget, turn thinking off,
 * or fix the prompt/model.
 */
export function explainParseFailure(stage: string, reply: ReplyShape): string {
  const { text, finishReason, reasoning } = reply;
  const truncated = finishReason === 'length' || finishReason === 'max_tokens';
  if (truncated) {
    return (
      `${stage}：模型输出被 max_tokens 截断（finish_reason=${finishReason}）。` +
      `推理模型（GLM / Qwen-thinking 等）会先输出 <think> 思考过程，通常是它吃光了预算——` +
      `请在模型侧关闭 thinking，或调大 token 预算。已收到：${modelReplySample(text || reasoning || '')}`
    );
  }
  if (!text.trim() && reasoning) {
    return (
      `${stage}：模型只返回了思考过程（reasoning_content），正文为空。请关闭 thinking 或调大 token 预算。` +
      `思考片段：${modelReplySample(reasoning)}`
    );
  }
  return `${stage}：模型没有按要求返回 JSON。模型实际返回：${modelReplySample(text)}`;
}
