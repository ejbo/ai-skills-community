// 知识库 译文 — the import-free half (client components, RSCs and API routes share it).
//
// Owner, 2026-10-07: 读者可以选 中文 / English / 原文；中文界面默认显示中文、英文界面默认显示
// 英文，阅读器里随时可调；标题也跟着语言走；正文自动翻译（分块交给模型）。
//
// Two content languages are translated INTO (the library stores zh/en twins, and
// i18n-content.ts already folds fr into en). A doc is readable in its 原文 plus
// every target that is not its own language:
//   中文 doc → English · English doc → 中文 · anything else (null) → both.

import { contentLocale } from './i18n-content';

export const LIBRARY_TARGET_LANGS = ['zh', 'en'] as const;
export type TargetLang = (typeof LIBRARY_TARGET_LANGS)[number];

export function isTargetLang(v: unknown): v is TargetLang {
  return v === 'zh' || v === 'en';
}

/** Languages a doc can be translated into (never its own). */
export function targetLangsFor(docLanguage: string | null | undefined): TargetLang[] {
  return LIBRARY_TARGET_LANGS.filter((l) => l !== docLanguage);
}

/** What the reader shows: the original text, or one translation. */
export type ReaderTextChoice = 'original' | TargetLang;
/** What the reader REMEMBERS (localStorage): follow the UI language, always 原文, or a fixed language. */
export type ReaderLangPref = 'auto' | ReaderTextChoice;

export function isReaderLangPref(v: unknown): v is ReaderLangPref {
  return v === 'auto' || v === 'original' || isTargetLang(v);
}

/**
 * Resolve the text to show. `auto` reads in the UI language (fr → English, like
 * the stored twins); a doc already in the wanted language shows its 原文.
 */
export function resolveReaderText(
  pref: ReaderLangPref,
  uiLocale: string | null | undefined,
  docLanguage: string | null | undefined,
): ReaderTextChoice {
  if (pref === 'original') return 'original';
  const want: TargetLang = pref === 'auto' ? contentLocale(uiLocale) : pref;
  return want === docLanguage ? 'original' : want;
}

/**
 * What to store when the reader picks `choice`. Picking the language the UI
 * would have chosen anyway stores `auto`, so a reader who never deviates keeps
 * following their UI language (and a later UI switch still applies).
 */
export function prefForChoice(
  choice: ReaderTextChoice,
  uiLocale: string | null | undefined,
  docLanguage: string | null | undefined,
): ReaderLangPref {
  return resolveReaderText('auto', uiLocale, docLanguage) === choice ? 'auto' : choice;
}

/**
 * Selection translation target: the viewer's language unless the doc is
 * already in it — then the other one (a 中文 reader selecting 中文 text gets English).
 */
export function selectionTargetFor(
  docLanguage: string | null | undefined,
  preferred: TargetLang,
): TargetLang {
  if (preferred !== docLanguage) return preferred;
  return targetLangsFor(docLanguage)[0] ?? preferred;
}

// ── titles ───────────────────────────────────────────────────────────────────

export interface TitleTranslations {
  source: string;
  zh?: string;
  en?: string;
}

/** Shape guard for the `LibraryDoc.titleTranslations` JSON column. */
export function asTitleTranslations(v: unknown): TitleTranslations | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.source !== 'string') return null;
  const out: TitleTranslations = { source: o.source };
  if (typeof o.zh === 'string' && o.zh.trim()) out.zh = o.zh.trim();
  if (typeof o.en === 'string' && o.en.trim()) out.en = o.en.trim();
  return out;
}

/** The title in `lang`, or null when there is none for the CURRENT title (self-invalidating). */
export function translatedTitle(
  title: string,
  translations: unknown,
  lang: TargetLang,
): string | null {
  const t = asTitleTranslations(translations);
  if (!t || t.source !== title) return null;
  return t[lang] ?? null;
}

/**
 * The title to DISPLAY for a viewer's UI locale (cards, lists, detail page): the
 * translation into the viewer's content language when the doc is in another
 * language and one exists, otherwise the original.
 */
export function pickDocTitle(
  locale: string | null | undefined,
  doc: { title: string; language?: string | null; titleTranslations?: unknown },
): string {
  const want = contentLocale(locale);
  if (doc.language === want) return doc.title;
  return translatedTitle(doc.title, doc.titleTranslations, want) ?? doc.title;
}
