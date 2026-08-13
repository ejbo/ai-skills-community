// 知识库 bilingual STORED CONTENT contract.
//
// Distinct from the UI i18n (messages/*.json): these are DB rows, not UI
// strings, so they cannot be looked up by key — the row carries a 中文 value
// and an English twin and the viewer's locale picks one at render time.
//
// Rules:
//  - 中文 is the source of truth AND the last-resort fallback. A missing English
//    twin renders the 中文 text rather than an empty section.
//  - The app supports 中/EN/FR; only two content languages are stored, so `fr`
//    reads the English twin (closer than 中文 for a francophone reader).
//  - Import-free on purpose (no next-intl, no prisma) — server RSCs, client
//    components and API routes all use it.

import type { AiOverview } from './types';

export type ContentLocale = 'zh' | 'en';

/** Map a next-intl locale ('zh-CN' | 'en' | 'fr') to a stored content language. */
export function contentLocale(locale: string | null | undefined): ContentLocale {
  return !locale || locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** Pick the localized string, falling back to the other language then ''. */
export function pickText(
  locale: string | null | undefined,
  zh: string | null | undefined,
  en: string | null | undefined,
): string {
  const wantEn = contentLocale(locale) === 'en';
  const primary = (wantEn ? en : zh)?.trim();
  if (primary) return primary;
  return (wantEn ? zh : en)?.trim() ?? '';
}

/** An overview counts as present only when it actually carries a summary. */
function hasOverview(o: AiOverview | null | undefined): o is AiOverview {
  return !!o && typeof o.summary === 'string' && o.summary.trim().length > 0;
}

/** Pick the localized AI 导读, falling back to the other language then null. */
export function pickOverview(
  locale: string | null | undefined,
  zh: AiOverview | null | undefined,
  en: AiOverview | null | undefined,
): AiOverview | null {
  const wantEn = contentLocale(locale) === 'en';
  const primary = wantEn ? en : zh;
  if (hasOverview(primary)) return primary;
  const secondary = wantEn ? zh : en;
  return hasOverview(secondary) ? secondary : null;
}

/** Shape guard for a JSON column read back from Prisma. */
export function asAiOverview(v: unknown): AiOverview | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.summary !== 'string') return null;
  const list = (x: unknown): string[] =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  return {
    summary: o.summary,
    outline: list(o.outline),
    keyPoints: list(o.keyPoints),
    questions: list(o.questions),
  };
}
