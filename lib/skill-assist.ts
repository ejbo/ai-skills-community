// Pure helpers for the author-side AI assist feature: assembling the skill
// content the model reads, building the per-action prompt, and parsing the
// model's JSON reply. No DB/env/LLM coupling, so it is trivially unit-testable.
// All LLM calls go through the same provider as Chat/Comparison (see lib/llm).

import { z } from 'zod';
import { estimateTokenCost } from '@/lib/skill-parser';

export const ASSIST_ACTIONS = [
  'autofill', // propose every empty metadata field at once
  'name',
  'summary', // one-line description
  'overview', // public Overview markdown (+ summary)
  'tags',
  'triggers',
  'tokens', // estimate token cost when the skill is loaded
  'pack', // write a skill-pack intro (summary + descriptionMd) from its member skills
] as const;

export type AssistAction = (typeof ASSIST_ACTIONS)[number];

export function isAssistAction(v: unknown): v is AssistAction {
  return typeof v === 'string' && (ASSIST_ACTIONS as readonly string[]).includes(v);
}

/**
 * Validation for the POST /api/skills/assist body. Defined here (not inline in the
 * route) so it stays pure + unit-testable. NO size caps on the skill text (internal
 * deploy — intentionally unrestricted): anything the upload/edit pipeline stored must
 * pass here. The only budget is the LLM context slice in buildAssistContext, which
 * truncates rather than rejects — so large skills work instead of 400'ing.
 */
export const assistInputSchema = z
  .object({
    action: z.string().refine(isAssistAction, 'unknown action'),
    // Required for every action except `pack`, which reads packSkills instead.
    skillMd: z.string().optional().nullable(),
    readme: z.string().optional().nullable(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    packSkills: z
      .array(
        z.object({
          name: z.string().min(1),
          summary: z.string().optional().nullable(),
          descriptionMd: z.string().optional().nullable(),
        }),
      )
      .optional(),
    current: z
      .object({
        name: z.string().optional(),
        summary: z.string().optional(),
        descriptionMd: z.string().optional(),
        tags: z.array(z.string()).optional(),
        triggers: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'pack') {
      if (!v.packSkills || v.packSkills.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['packSkills'],
          message: '先给合集包添加至少一个 skill',
        });
      }
    } else if (!v.skillMd?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['skillMd'], message: '缺少 skill 内容' });
    }
  });

export type AssistInput = z.infer<typeof assistInputSchema>;

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

/**
 * Per-action context budget (chars). Metadata actions read a small head of the
 * skill — a name/summary/tags proposal doesn't change past the first pages, and
 * a small prompt keeps generation fast on large skills. `tokens` isn't listed:
 * it is computed deterministically without an LLM call (see the assist route).
 */
export const ASSIST_CONTEXT_CHARS: Partial<Record<AssistAction, number>> = {
  name: 12 * 1024,
  summary: 16 * 1024,
  tags: 12 * 1024,
  triggers: 16 * 1024,
  overview: 32 * 1024,
  autofill: 32 * 1024,
  pack: 16 * 1024,
};

/**
 * Assemble the model-readable skill content from client-provided text. When the
 * budget cuts anything, a note states the full size so the model knows it saw
 * a slice (and never claims the skill "ends" where the cut happened).
 */
export function buildAssistContext(
  input: AssistContextInput,
  maxChars: number = MAX_CONTEXT_CHARS,
): string {
  const skillMd = input.skillMd ?? '';
  const parts: string[] = [];
  parts.push(`# SKILL.md\n${skillMd.slice(0, maxChars)}`);
  let used = parts[0].length;
  let truncated = skillMd.length > maxChars;
  if (input.readme && input.readme.trim()) {
    const block = `\n\n# README\n${input.readme}`;
    if (used + block.length <= maxChars) {
      parts.push(block);
      used += block.length;
    } else {
      truncated = true;
    }
  }
  for (const f of input.files ?? []) {
    if (!f.content || !f.content.trim()) continue;
    if (/(^|\/)skill\.md$/i.test(f.path) || /(^|\/)readme/i.test(f.path)) continue;
    const block = `\n\n# FILE: ${f.path}\n${f.content}`;
    if (used + block.length > maxChars) {
      truncated = true;
      break;
    }
    parts.push(block);
    used += block.length;
  }
  if (truncated) {
    const totalChars =
      skillMd.length +
      (input.readme?.length ?? 0) +
      (input.files ?? []).reduce((n, f) => n + (f.content?.length ?? 0), 0);
    parts.push(`\n\n[注意：内容过长已截断，以上为节选；完整内容共约 ${totalChars} 字符]`);
  }
  return parts.join('');
}

const BASE_SYSTEM =
  '你是一个帮助作者整理「AI agent skill」元信息的助手。' +
  '你只输出 JSON，不要任何解释、前后缀或 Markdown 代码围栏。' +
  '所有面向用户的文案使用简体中文（除非该 skill 本身明显是英文受众）。';

export interface PackSkillInput {
  name: string;
  summary?: string | null;
  descriptionMd?: string | null;
}

/**
 * Assemble the model-readable member list for the `pack` action. Deliberately
 * light: name + one-liner (+ optionally a slice of the overview) per member —
 * never the member skills' full bodies.
 */
export function buildPackAssistContext(skills: PackSkillInput[]): string {
  const budget = ASSIST_CONTEXT_CHARS.pack ?? MAX_CONTEXT_CHARS;
  const parts: string[] = [];
  let used = 0;
  for (const s of skills) {
    const summary = (s.summary ?? '').trim();
    const desc = (s.descriptionMd ?? '').trim().slice(0, 600);
    const block = `## ${s.name}${summary ? `\n一句话：${summary}` : ''}${desc ? `\n简介：${desc}` : ''}`;
    if (used + block.length > budget) break;
    parts.push(block);
    used += block.length;
  }
  return parts.join('\n\n');
}

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
    case 'pack': {
      const packName = current.name?.trim();
      const wantName = packName ? '' : '，另给出简洁包名 name（2-6 个词）';
      const shape = packName
        ? '{"summary": "...", "descriptionMd": "..."}'
        : '{"name": "...", "summary": "...", "descriptionMd": "..."}';
      return {
        system: BASE_SYSTEM,
        user:
          `下面是一个「skill 合集包」的成员 skills 列表${packName ? `（包名：${packName}）` : ''}：\n\n${context}\n\n` +
          `请为这个合集包撰写介绍${wantName}：\n` +
          `summary=一句话（不超过 40 个汉字）说明这个包解决什么场景；\n` +
          `descriptionMd=Markdown 介绍，依次包含：1-2 句总述；「### 包含内容」小节逐条列出每个 skill 及其作用（一行一个）；` +
          `「### 适用场景」小节给出 3-5 条什么情况下应该安装这个包。\n` +
          `只返回 JSON：${shape}`,
        maxTokens: 1500,
      };
    }
  }
}

/** Strip code fences and extract the first balanced JSON object. */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text
    // Reasoning models (GLM, DeepSeek, Qwen-thinking, …) emit a <think>…</think> block
    // before the answer; it can contain braces that derail JSON extraction. Drop it first.
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
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

  if (action === 'name' || action === 'autofill' || action === 'pack') {
    const name = asString(obj.name);
    // Pack names are capped at 80 by the admin API schema; skills allow 120.
    if (name) result.name = name.slice(0, action === 'pack' ? 80 : 120);
  }
  if (action === 'summary' || action === 'overview' || action === 'autofill' || action === 'pack') {
    const summary = asString(obj.summary);
    if (summary) result.summary = summary.slice(0, 140);
  }
  if (action === 'overview' || action === 'autofill' || action === 'pack') {
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
