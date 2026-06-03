// Pure helpers for the author-side AI assist feature: assembling the skill
// content the model reads, building the per-action prompt, and parsing the
// model's JSON reply. No DB/env/LLM coupling, so it is trivially unit-testable.
// All LLM calls go through the same provider as Chat/Comparison (see lib/llm).

import { estimateTokenCost } from '@/lib/skill-parser';

export const ASSIST_ACTIONS = [
  'autofill', // propose every empty metadata field at once
  'name',
  'summary', // one-line description
  'overview', // public Overview markdown (+ summary)
  'tags',
  'triggers',
  'tokens', // estimate token cost when the skill is loaded
] as const;

export type AssistAction = (typeof ASSIST_ACTIONS)[number];

export function isAssistAction(v: unknown): v is AssistAction {
  return typeof v === 'string' && (ASSIST_ACTIONS as readonly string[]).includes(v);
}

export interface AssistContextInput {
  skillMd: string;
  readme?: string | null;
  /** Extra supporting text files (path + content); capped for length. */
  files?: { path: string; content: string }[];
}

export interface AssistCurrent {
  name?: string;
  summary?: string;
  descriptionMd?: string;
  tags?: string[];
  triggers?: string[];
}

const MAX_CONTEXT_CHARS = 120 * 1024;

/** Assemble the model-readable skill content from client-provided text. */
export function buildAssistContext(input: AssistContextInput): string {
  const parts: string[] = [];
  parts.push(`# SKILL.md\n${(input.skillMd ?? '').slice(0, MAX_CONTEXT_CHARS)}`);
  let used = parts[0].length;
  if (input.readme && input.readme.trim()) {
    const block = `\n\n# README\n${input.readme}`;
    if (used + block.length <= MAX_CONTEXT_CHARS) {
      parts.push(block);
      used += block.length;
    }
  }
  for (const f of input.files ?? []) {
    if (!f.content || !f.content.trim()) continue;
    if (/(^|\/)skill\.md$/i.test(f.path) || /(^|\/)readme/i.test(f.path)) continue;
    const block = `\n\n# FILE: ${f.path}\n${f.content}`;
    if (used + block.length > MAX_CONTEXT_CHARS) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join('');
}

const BASE_SYSTEM =
  '你是一个帮助作者整理「AI agent skill」元信息的助手。' +
  '你只输出 JSON，不要任何解释、前后缀或 Markdown 代码围栏。' +
  '所有面向用户的文案使用简体中文（除非该 skill 本身明显是英文受众）。';

function emptyList(current: AssistCurrent): string[] {
  const missing: string[] = [];
  if (!current.name?.trim()) missing.push('name');
  if (!current.summary?.trim()) missing.push('summary');
  if (!current.descriptionMd?.trim()) missing.push('descriptionMd');
  if (!current.tags || current.tags.length === 0) missing.push('tags');
  if (!current.triggers || current.triggers.length === 0) missing.push('triggers');
  return missing;
}

export interface AssistPrompt {
  system: string;
  user: string;
  maxTokens: number;
}

/** Build the {system,user} prompt + token budget for one assist action. */
export function buildAssistPrompt(
  action: AssistAction,
  context: string,
  current: AssistCurrent = {},
): AssistPrompt {
  const head = `下面是某个 skill 的内容：\n\n${context}\n\n`;

  switch (action) {
    case 'name':
      return {
        system: BASE_SYSTEM,
        user: `${head}请为它起一个简洁、准确的名称（2-6 个词）。只返回 JSON：{"name": "..."}`,
        maxTokens: 200,
      };
    case 'summary':
      return {
        system: BASE_SYSTEM,
        user: `${head}请写一句话描述（summary），不超过 40 个汉字、突出它能做什么。只返回 JSON：{"summary": "..."}`,
        maxTokens: 300,
      };
    case 'overview':
      return {
        system: BASE_SYSTEM,
        user:
          `${head}请生成面向所有访问者的「公开简介 Overview」（Markdown，3-8 行，介绍用途、关键能力、适用场景），` +
          `同时给出一句话描述 summary。只返回 JSON：{"summary": "...", "descriptionMd": "..."}`,
        maxTokens: 1200,
      };
    case 'tags':
      return {
        system: BASE_SYSTEM,
        user: `${head}请给出 3-6 个小写、简短的标签（英文或中文单词，不带 # 号）。只返回 JSON：{"tags": ["...", "..."]}`,
        maxTokens: 300,
      };
    case 'triggers':
      return {
        system: BASE_SYSTEM,
        user:
          `${head}请给出 3-6 个「触发词/触发场景」——即用户说什么、或遇到什么任务时应该用这个 skill。` +
          `简短短语即可。只返回 JSON：{"triggers": ["...", "..."]}`,
        maxTokens: 400,
      };
    case 'tokens':
      return {
        system: BASE_SYSTEM,
        user:
          `${head}请估算「当这个 skill 被加载进上下文时大约消耗多少 tokens」（统计 SKILL.md 正文及随附文本文件的体量，` +
          `按约 4 字符≈1 token 估算，取整数）。只返回 JSON：{"tokenCost": 1234}`,
        maxTokens: 200,
      };
    case 'autofill': {
      const missing = emptyList(current);
      const want = missing.length > 0 ? missing : ['name', 'summary', 'descriptionMd', 'tags', 'triggers'];
      return {
        system: BASE_SYSTEM,
        user:
          `${head}请只为以下还空着的字段生成内容：${want.join(', ')}。\n` +
          `字段含义：name=简洁名称；summary=一句话描述(<40字)；descriptionMd=公开简介(Markdown,3-8行)；` +
          `tags=3-6个小写短标签数组；triggers=3-6个触发短语数组。\n` +
          `只返回包含这些字段的 JSON 对象，不要包含未要求的字段。例如：` +
          `{"name":"...","summary":"...","descriptionMd":"...","tags":["..."],"triggers":["..."]}`,
        maxTokens: 1600,
      };
    }
  }
}

/** Strip code fences and extract the first balanced JSON object. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1));
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asStringList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  return out.length > 0 ? out.slice(0, 12) : undefined;
}

export interface AssistResult {
  name?: string;
  summary?: string;
  descriptionMd?: string;
  tags?: string[];
  triggers?: string[];
  tokenCost?: number;
}

/**
 * Parse the model reply for an action into a normalized result. For `tokens`,
 * falls back to the deterministic heuristic over the context when the model
 * doesn't return a usable number.
 */
export function parseAssistResult(
  action: AssistAction,
  text: string,
  context: string,
): AssistResult {
  const obj = extractJsonObject(text) ?? {};
  const result: AssistResult = {};

  if (action === 'tokens') {
    const n = typeof obj.tokenCost === 'number' ? obj.tokenCost : Number(obj.tokenCost);
    result.tokenCost =
      Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 50000) : estimateTokenCost(context);
    return result;
  }

  if (action === 'name' || action === 'autofill') {
    const name = asString(obj.name);
    if (name) result.name = name.slice(0, 120);
  }
  if (action === 'summary' || action === 'overview' || action === 'autofill') {
    const summary = asString(obj.summary);
    if (summary) result.summary = summary.slice(0, 140);
  }
  if (action === 'overview' || action === 'autofill') {
    const overview = asString(obj.descriptionMd);
    if (overview) result.descriptionMd = overview;
  }
  if (action === 'tags' || action === 'autofill') {
    const tags = asStringList(obj.tags);
    if (tags) result.tags = tags.map((t) => t.toLowerCase().replace(/^#/, '').trim()).filter(Boolean);
  }
  if (action === 'triggers' || action === 'autofill') {
    const triggers = asStringList(obj.triggers);
    if (triggers) result.triggers = triggers;
  }
  return result;
}
