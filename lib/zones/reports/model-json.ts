// 版块报告 — 模型回复 → JSON（纯函数，不碰 env / DB，测试直接跑）。
// 顺序：extractJsonObject（围栏、前后废话、全角引号、推理标签）→ 直接 JSON.parse → jsonrepair（尾逗号、注释、
// 单引号、未引号的键、被截断的结尾）。返回对象或数组；都不行 null。形状上的事交给 coerce.ts。

import { jsonrepair } from 'jsonrepair';
import { extractJsonObject, stripReasoning } from '@/lib/skill-assist';

/**
 * 模型 JSON 的宽松解析：围栏、前后废话、全角引号交给 extractJsonObject；它认不出（尾逗号、注释、单引号、
 * 被截断、顶层是数组）再用 jsonrepair 修一遍。返回对象或数组；都不行 null。
 */
export function parseModelJson(text: string): unknown {
  let t = (stripReasoning(text) ?? text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  const a = Math.min(...[t.indexOf('{'), t.indexOf('[')].filter((i) => i >= 0));
  if (Number.isFinite(a) && a > 0) t = t.slice(a);
  // 顶层是数组（模型把 themes 直接当顶层）：extractJsonObject 会挖出数组里第一个对象，所以数组先走直接解析
  if (!t.startsWith('[')) {
    const obj = extractJsonObject(text);
    if (obj) return obj;
  }
  for (const candidate of [t, safeRepair(t)]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

function safeRepair(t: string): string | null {
  try {
    return jsonrepair(t);
  } catch {
    return null;
  }
}

