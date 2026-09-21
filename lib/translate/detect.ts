// Language detection for 站内翻译 — a pure heuristic, no model call and NO stored
// column: it is run identically on the client (to decide whether to SHOW the 翻译
// link) and on the server (to answer `same` without touching the model, and to
// fill 译自{lang}). Because nothing is stored, a better heuristic fixes every item
// retroactively. (docs/translation-design.md §3.8)
//
// Order matters: everything that is not prose is stripped FIRST — a 中文 comment
// that is mostly a code block or a URL must not read as English.

import type { ContentLang } from './shared';

/** CJK share of letter-class characters at which text counts as 中文 (the library's threshold). */
export const CJK_THRESHOLD = 0.15;
const SAMPLE_CHARS = 4000;

const FENCE_BLOCK_RE = /(^|\n) {0,3}(`{3,}|~{3,})[\s\S]*?(\n {0,3}\2[`~]*[ \t]*(?=\n|$)|$)/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+|\b[\w.+-]+@[\w-]+\.[\w.-]+/gi;
const LINK_DEST_RE = /\]\([^)\n]*\)/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>\n]*>/g;
const TOKEN_LINE_RE = /^ {0,3}\\?\[(?:poll|embed):[^\]\n]*\\?\][ \t]*$/gm;
const MENTION_RE = /@[^\s\]]{1,40}/g;
const PLACEHOLDER_RE = /⟦\d+⟧/g;

/** The prose of a markdown / plain string: code, URLs, tags, tokens and mentions removed. */
export function proseOf(text: string): string {
  return text
    .slice(0, SAMPLE_CHARS * 2)
    .replace(FENCE_BLOCK_RE, '\n')
    .replace(TOKEN_LINE_RE, '')
    .replace(INLINE_CODE_RE, ' ')
    .replace(LINK_DEST_RE, '] ')
    .replace(URL_RE, ' ')
    .replace(HTML_TAG_RE, ' ')
    .replace(PLACEHOLDER_RE, ' ')
    .replace(MENTION_RE, ' ')
    .slice(0, SAMPLE_CHARS);
}

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/g;
const LATIN_RE = /[A-Za-zÀ-ɏ]/g;
const LETTER_RE = /[\p{L}]/gu;
const FR_DIACRITIC_RE = /[àâçéèêëîïôûùüÿœæ]/gi;

// Function words only — content words overlap between the two languages.
const FR_STOP = new Set(
  'le la les des du de est une un et pour avec dans sur pas que qui ce cette ces nous vous ils elles sont être avoir plus très aussi mais ou donc au aux par se ne je tu il elle on mon ton son notre votre leur y en'.split(
    ' ',
  ),
);
const EN_STOP = new Set(
  'the and is of to with that for you are this it in on be as at by an or from not have has was were will can we they i he she but if so do does what which when how'.split(
    ' ',
  ),
);

function count(text: string, re: RegExp): number {
  return text.match(re)?.length ?? 0;
}

/**
 * True when the text has something a translator could act on: ≥ 1 CJK character
 * or ≥ 2 letters of prose. 「+1」, 「👍」, a bare sticker, a lone URL or a code block
 * get no link, no call and no cache row.
 */
export function hasTranslatableText(text: string | null | undefined): boolean {
  if (!text) return false;
  const prose = proseOf(text);
  return count(prose, CJK_RE) >= 1 || count(prose, LETTER_RE) >= 2;
}

/**
 * Is the text substantial enough to OFFER a 翻译 link under it? Stricter than
 * `hasTranslatableText` on purpose, and used by the UI only: 「LGTM」, 「nice 👍」 or
 * 「好」 under every other comment is noise, not help. The server stays permissive —
 * anything with prose can be translated when something does ask.
 */
export function worthOffering(text: string | null | undefined): boolean {
  if (!text) return false;
  const prose = proseOf(text);
  if (count(prose, CJK_RE) >= 2) return true;
  return (prose.match(/[\p{L}][\p{L}'’-]*/gu) ?? []).length >= 3;
}

/** 'zh' | 'en' | 'fr', or null when it cannot tell (too short, another script, mixed). */
export function detectContentLang(text: string | null | undefined): ContentLang | null {
  if (!text) return null;
  const prose = proseOf(text);
  const letters = count(prose, LETTER_RE);
  if (letters === 0) return null;
  const cjk = count(prose, CJK_RE);
  if (cjk / letters >= CJK_THRESHOLD) return 'zh';

  const latin = count(prose, LATIN_RE);
  if (latin / letters < 0.5) return null;

  const words = prose.toLowerCase().match(/[a-zÀ-ɏ']+/g) ?? [];
  let fr = 0;
  let en = 0;
  for (const w of words) {
    // l'… d'… qu'… j'… — the elided article is the French signal, the rest is a content word.
    const head = w.includes("'") ? w.split("'")[0] : w;
    if (FR_STOP.has(w) || (w.includes("'") && /^(l|d|qu|j|n|s|c|m|t)$/.test(head))) fr++;
    if (EN_STOP.has(w)) en++;
  }
  const diacritics = count(prose, FR_DIACRITIC_RE);
  const frByAccent = diacritics >= 2 && diacritics / latin >= 0.005;
  if ((frByAccent && fr >= en) || (fr >= 3 && fr > en)) return 'fr';
  return 'en';
}

/**
 * Does `text` read as `lang`? The OUTPUT guard: a reply that is still in the
 * source language means the model echoed instead of translating. Lenient on
 * purpose (short outputs, names and code-heavy lines must pass): only a confident
 * detection of a DIFFERENT language fails.
 */
export function looksLikeLang(text: string, lang: ContentLang): boolean {
  const detected = detectContentLang(text);
  if (detected === null || detected === lang) return true;
  // Too short to judge: 「GPU」 is a perfectly good 中文 translation of "GPU".
  if (count(proseOf(text), LETTER_RE) < 12) return true;
  // en ↔ fr are easily confused on short strings; only zh vs latin is decisive there.
  if (detected !== 'zh' && lang !== 'zh' && count(proseOf(text), LETTER_RE) < 40) return true;
  return false;
}
