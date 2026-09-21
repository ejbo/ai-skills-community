// 站内翻译 — the import-free, client-safe contract (docs/translation-design.md §3.3).
// Everything here is pure: the client uses it to decide whether to SHOW the 翻译
// link, the server to key the cache and to answer `same` / `nothing` without a
// model call. No zod, no node builtins, no next-intl.
//
// Shape of the feature (X / Mastodon / Slack model): a translation is
// VIEWER-SIDE RENDER STATE backed by a shared cache. It is never written into
// content, never broadcast, and the original is always one click away.

export const CONTENT_LANGS = ['zh', 'en', 'fr'] as const;
/** A language content can be translated INTO — one per UI locale. */
export type ContentLang = (typeof CONTENT_LANGS)[number];

export function isContentLang(v: unknown): v is ContentLang {
  return v === 'zh' || v === 'en' || v === 'fr';
}

/**
 * The language a viewer reads, from the UI locale — 1:1 (zh-CN→zh, en→en, fr→fr).
 * Deliberately NOT lib/library/i18n-content.ts#contentLocale, which folds fr into
 * en for the library's stored zh/en twins: a French reader translates INTO French.
 */
export function viewerLang(locale: string | null | undefined): ContentLang {
  const l = (locale ?? '').toLowerCase();
  if (l.startsWith('zh')) return 'zh';
  if (l.startsWith('fr')) return 'fr';
  return 'en';
}

/** How the model is told the target (and how guards name it). */
export const LANG_ENGLISH_NAME: Record<ContentLang, string> = {
  zh: 'Simplified Chinese',
  en: 'English',
  fr: 'French',
};

/** How one field's text is segmented and protected. */
export type FieldFormat = 'md' | 'plain' | 'title';
export type FieldName = 'title' | 'summary' | 'body';

export interface TranslateKindSpec {
  fields: Partial<Record<FieldName, FieldFormat>>;
  /** Readable without signing in ⇒ an anonymous viewer may receive CACHE HITS (never a model call). */
  public: boolean;
}

/**
 * Every translatable content kind. The key is what the client sends
 * (`{kind,id}`); lib/translate/sources.ts holds one loader per key, and a test
 * asserts the two stay in step. Adding a surface = one entry here + one loader
 * (+ wrapping its render in <Translatable/>) — the route and the UI never change.
 */
export const TRANSLATE_KINDS = {
  // 动态 / 讨论 (publicly readable)
  post: { fields: { body: 'md' }, public: true },
  post_comment: { fields: { body: 'md' }, public: true },
  topic: { fields: { title: 'title', body: 'md' }, public: true },
  topic_reply: { fields: { body: 'md' }, public: true },
  // 意见反馈
  feedback: { fields: { title: 'title', body: 'md' }, public: true },
  feedback_comment: { fields: { body: 'md' }, public: true },
  // 视频评论 (long videos AND shorts share VideoComment)
  video_comment: { fields: { body: 'md' }, public: false },
  // 技术专区
  zone_post: { fields: { title: 'title', summary: 'plain', body: 'md' }, public: false },
  zone_comment: { fields: { body: 'md' }, public: false },
  // 知识库 (chapters keep their own 译文 pipeline — lib/library/translate-doc.ts)
  library_comment: { fields: { body: 'md' }, public: false },
  library_note: { fields: { body: 'plain' }, public: false },
  library_note_reply: { fields: { body: 'plain' }, public: false },
  // 投票活动
  vote_comment: { fields: { body: 'plain' }, public: false },
} as const satisfies Record<string, TranslateKindSpec>;

export type TranslateKind = keyof typeof TRANSLATE_KINDS;

export function isTranslateKind(v: unknown): v is TranslateKind {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TRANSLATE_KINDS, v);
}

// ── limits ───────────────────────────────────────────────────────────────────

/** One translatable block sent to the model. Longer blocks are split on sentence ends. */
export const MAX_BLOCK_CHARS = 1500;
/** A block past this is left untranslated (`partial`) rather than sent. */
export const MAX_OPAQUE_BLOCK_CHARS = 6000;
/** All fields of one item. Past it the route answers 413 (a background pass is a separate follow-up). */
export const MAX_ITEM_CHARS = 24_000;
/** Items per batch request (auto mode coalesces what scrolled into view). */
export const MAX_BATCH_ITEMS = 30;
export const MAX_SKIP_LANGS = 3;

// ── wire types ───────────────────────────────────────────────────────────────

export interface TranslationView {
  target: ContentLang;
  /** Detected source language; null = could not tell (the attribution then says 其他语言). */
  sourceLang: ContentLang | null;
  /** Translated text per field — same keys the item was sent with. */
  fields: Partial<Record<FieldName, string>>;
  /** `partial`: some blocks kept their original text (a guard rejected the model's reply). */
  state: 'ready' | 'partial';
  /** Label for the attribution line (the served model's display name). */
  engine: string;
}

export type TranslateOutcome =
  | ({ status: 'ok'; cached: boolean } & TranslationView)
  /** Already in the viewer's language — hide the link. */
  | { status: 'same'; sourceLang: ContentLang | null }
  /** Nothing to translate (emoji, a bare link, code only) — hide the link. */
  | { status: 'nothing' }
  /** Anonymous viewer + cache miss, or a batch item that needs the model: ask again through the single-item route. */
  | { status: 'pending' }
  | { status: 'error'; error: TranslateErrorCode };

export type TranslateErrorCode =
  | 'unauthenticated'
  | 'not_found'
  | 'translate_too_long'
  | 'translate_rate_limited'
  | 'translate_unavailable'
  | 'translate_failed'
  | 'invalid_input';

/** `kind:id` — the key of a batch result and of the client's result cache. */
export function translateItemKey(kind: TranslateKind, id: string): string {
  return `${kind}:${id}`;
}

// ── viewer preferences ───────────────────────────────────────────────────────

export interface TranslatePrefsData {
  /** A provider is configured and the kill switch is on. false ⇒ the link is never rendered (no dead buttons). */
  available: boolean;
  /** Display name of the engine, for the attribution line. */
  engine: string | null;
  viewerLang: ContentLang;
  signedIn: boolean;
  /** 自动翻译: items in another language are translated as they scroll into view. Opt-in. */
  autoTranslate: boolean;
  /** 「不翻译此语言」: source languages the viewer reads fine. */
  skipLangs: ContentLang[];
}

export function sanitizeSkipLangs(raw: unknown): ContentLang[] {
  if (!Array.isArray(raw)) return [];
  const out: ContentLang[] = [];
  for (const v of raw) {
    if (isContentLang(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_SKIP_LANGS) break;
  }
  return out;
}

// ── cache key ────────────────────────────────────────────────────────────────

/**
 * Cache-key normalisation: collapse whitespace so the same passage hits the same
 * row however it was wrapped. For the HASH only — stored and returned text keep
 * their newlines. (Same rule as lib/library/translation.ts#normalizeSource.)
 */
export function normalizeSource(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Tiny non-cryptographic hash for CLIENT cache keys (drops a stale entry after an in-place edit). */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
