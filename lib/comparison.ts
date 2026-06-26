// Pure helpers for the author-side Comparison feature: the structured template
// the AI fills, the workshop system prompt (skill + the two real runs), and
// validation of the stored `example` artifact.

import { z } from 'zod';

export interface ComparisonExample {
  taskPrompt: string;
  withOutput: string;
  withoutOutput: string;
}

/** Shape of a real 装上/不装 dual-run, as sent from the studio. */
export const comparisonExampleSchema = z.object({
  taskPrompt: z.string().min(1).max(4000),
  withOutput: z.string().max(20000),
  withoutOutput: z.string().max(20000),
});

/**
 * PUT body for saving/publishing a comparison. `bodyMd` / `guidancePrompt` /
 * `model` mirror nullable DB columns and the studio sends whatever it currently
 * holds in state — `model` in particular is `null` until a baseline/generation
 * captures one. `.optional()` alone rejects an explicit `null`, which was 400-ing
 * every publish that hadn't produced a model yet; allowing null lets an unset
 * value round-trip. (Publishing still requires a non-empty body — enforced in the
 * route, not here, so a draft can be saved empty.)
 */
export const comparisonPutSchema = z.object({
  bodyMd: z.string().max(40000).nullable().optional(),
  example: comparisonExampleSchema.nullable().optional(),
  guidancePrompt: z.string().max(8000).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  status: z.enum(['draft', 'published']),
});

/** The fixed sections the analysis report fills, in order. */
export const COMPARISON_SECTIONS = ['一句话价值', '关键能力', 'Before / After', '适用场景'] as const;

/** Default author guidance, pre-filled in the workshop and overridable. */
export const DEFAULT_GUIDANCE_PROMPT =
  '请基于这个 skill 以及它在「装上 / 不装」时的两次真实运行结果，写一份结构化的对比说明，' +
  '突出装上这个 skill 带来的差别和价值。';

/**
 * System prompt for the workshop analysis chat. The model always has the skill
 * loaded; its job is to *analyze* the difference装上 vs 不装 (not merely restate
 * outputs), because a raw diff is often subtle — without the skill the baseline
 * is effectively "nothing special".
 *
 * `example` (a real 装上/不装 dual-run) is OPTIONAL. The 实测 step is optional in
 * the workshop, so the author can one-click generate the comparison copy from the
 * skill content alone; when a real run IS provided it's woven in as evidence.
 */
export function buildComparisonSystemPrompt(
  skillContext: string,
  example?: ComparisonExample | null,
): string {
  const sections = COMPARISON_SECTIONS.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const intro =
    `你在帮助一位 skill 作者撰写「装上 vs 不装这个 skill」的对比说明，给浏览者看。\n\n` +
    `下面是该 skill 的完整内容：\n${skillContext}\n\n`;

  if (example) {
    return (
      intro +
      `针对同一个任务，已经用相同模型真实运行了两次（一次装上该 skill、一次不装作为基线），结果如下：\n\n` +
      `【任务 Prompt】\n${example.taskPrompt}\n\n` +
      `【不装（baseline）的真实输出】\n${example.withoutOutput}\n\n` +
      `【装上该 skill 的真实输出】\n${example.withOutput}\n\n` +
      `请结合这两次真实结果**以及你对该 skill 的理解**，写一份清晰、结构化的对比报告（Markdown）。` +
      `不要只是复述两段输出——要分析装上之后到底改变了什么、价值在哪。` +
      `如果两次原始输出表面差别不明显，请解释 skill 实际会带来的差异。\n\n` +
      `报告必须包含以下小节：\n${sections}\n\n` +
      `「Before / After」小节请用简明的对照（可用表格或两栏要点）呈现「不装」与「装上」的差别。`
    );
  }

  // No 实测 yet — generate from the author's skill content alone.
  return (
    intro +
    `请基于你对该 skill 的理解，写一份清晰、结构化的对比说明（Markdown），` +
    `突出装上这个 skill 相比不装它能带来的差别和价值。\n\n` +
    `报告必须包含以下小节：\n${sections}\n\n` +
    `「Before / After」小节请用简明的对照（可用表格或两栏要点）呈现「不装」与「装上」的差别。`
  );
}

/** Validate/normalize an `example` value loaded from JSON; null if malformed. */
export function parseComparisonExample(value: unknown): ComparisonExample | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.taskPrompt === 'string' &&
    typeof v.withOutput === 'string' &&
    typeof v.withoutOutput === 'string'
  ) {
    return { taskPrompt: v.taskPrompt, withOutput: v.withOutput, withoutOutput: v.withoutOutput };
  }
  return null;
}
