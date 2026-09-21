// 站内翻译 — segmentation + protection. Pure and client-safe; pinned by
// tests/translate-markdown.test.ts. (docs/translation-design.md §3.7)
//
// PRINCIPLE (carried over from lib/library/translate-doc.ts): model output is
// never trusted as markup. We cut a field into UNITS, send only prose, and put
// each reply back into a slot we control; a unit whose reply fails a guard keeps
// its original text (`partial`). Two consequences shape this file:
//
//  1. STRUCTURE IS OURS. A unit's structural prefix — heading `#`, list marker,
//     task box, `>` depth, table pipes — is cut off before the model sees the
//     text and glued back afterwards. The model cannot break a list or a table
//     because it never sees one.
//  2. EVERYTHING OPAQUE IS A PLACEHOLDER. Inline code, link / image destinations,
//     whole images, @mentions, raw HTML tags, URLs, footnote refs and stray
//     tokens become ⟦n⟧ before the call and are restored by index after. So the
//     RAW reply must contain no URL, no tag, no link destination, no backtick:
//     anything of that kind was INVENTED by the model (or by a prompt injection
//     in the source) and rejects the unit (lib/translate/guards.ts).
//
// Own-line `[poll:<id>]` / `[embed:<kind>:<ref>]` tokens, fenced code, image-only
// lines, HTML-only lines (`<div data-lh="2">`, `<details>`), table alignment rows
// and rules are OPAQUE CHUNKS: emitted byte-identical and own-line, so the poll
// widget / embed card still mount and `collectEmbedRefs(translated)` equals
// `collectEmbedRefs(original)` — server-resolved embeds keep working.
//
// `segment(text).chunks.map(c => c.raw).join('')` === text, always. That identity
// is what lets `assemble` be a plain join.

import { MAX_BLOCK_CHARS, MAX_OPAQUE_BLOCK_CHARS, normalizeSource, type FieldFormat } from './shared';
import { hasTranslatableText } from './detect';

export const PH_OPEN = '⟦';
export const PH_CLOSE = '⟧';
const PH_RE = /⟦(\d+)⟧/g;

export interface Unit {
  /** Index into `Segmented.units`. */
  index: number;
  /** The unit's source text WITHOUT its structural prefix — what the cache is keyed on. */
  source: string;
  /** `source` with opaque spans replaced by ⟦n⟧ — what the model sees. */
  protectedText: string;
  /** Placeholder index → original span. */
  slots: string[];
  /** True when the reply must be a single line (titles, table cells, headings). */
  singleLine: boolean;
}

interface Chunk {
  /** Exact source slice (newline included) — emitted as is unless `unit` resolves. */
  raw: string;
  /** Translatable: prefix + unit text + suffix === raw. */
  unit?: number;
  prefix?: string;
  suffix?: string;
}

export interface Segmented {
  chunks: Chunk[];
  units: Unit[];
  /** Units that were too long to send — the item can be `partial` at best. */
  skipped: number;
}

// ── protection ───────────────────────────────────────────────────────────────

// Order matters: code first (nothing inside it is markup), then constructs that
// CONTAIN urls/brackets, then the bare leftovers. A pattern whose FIRST capture
// group is a "lead" keeps that lead OUTSIDE the slot (the `]` of a link, the
// space before a #hashtag) — see `protect`.
interface ProtectRule {
  re: RegExp;
  /** Capture group 1 is text to keep in place; the slot is the rest of the match. */
  lead?: boolean;
}

const PROTECT_RULES: ProtectRule[] = [
  // literal placeholder brackets in the SOURCE — must run first: every later rule mints real
  // placeholders, and this one would otherwise swallow their brackets.
  { re: /[\u27E6\u27E7]+/g },
  // inline code, longest-backtick-run aware
  { re: /(`+)(?:(?!\1)[\s\S])*?\1/g },
  // @mention links, possibly wrapped in emphasis — label and handle both opaque (lib/mentions.ts)
  { re: /\[(?:\*{1,3}|_{1,3}|~~)*@[^\]\n]{1,80}?(?:\*{1,3}|_{1,3}|~~)*\]\(\/users\/[A-Za-z0-9._-]{1,64}\)/g },
  // whole images (alt is not translated: stickers and uploads key on the exact markup)
  { re: /!\[[^\]\n]*\]\([^)\n]*\)/g },
  // HTML comments, then raw HTML tags (open / close / void, attributes intact)
  { re: /<!--[\s\S]*?-->/g },
  { re: /<\/?[a-zA-Z][^<>\n]*>/g },
  // link destination incl. optional title. The `]` stays in the text so the model sees a
  // balanced `[text]`; `restore` closes any gap a model opens between `]` and the slot.
  { re: /(\])(\((?:[^()\n]|\([^()\n]*\))*\))/g, lead: true },
  // reference-style tail `][ref]`, then footnote refs `[^1]`
  { re: /(\])(\[[^\]\n]*\])/g, lead: true },
  { re: /\[\^[^\]\n]+\]/g },
  // inline poll / embed tokens (own-line ones never reach here)
  { re: /\\?\[(?:poll|embed):[^\]\n]*\\?\]/g },
  // autolinks, bare URLs, e-mails
  { re: /<(?:https?:\/\/|mailto:)[^>\s]+>|\b(?:https?:\/\/|www\.)[^\s<>()\u27E6\u27E7]+|\b[\w.+-]+@[\w-]+\.[\w.-]+/gi },
];

const PLAIN_RULES: ProtectRule[] = [
  { re: /[\u27E6\u27E7]+/g },
  { re: /\b(?:https?:\/\/|www\.)[^\s<>()\u27E6\u27E7]+|\b[\w.+-]+@[\w-]+\.[\w.-]+/gi },
  // @handle and #hashtag in captions / plain comments (the char before them stays in place)
  { re: /(^|[\s(\uFF08])([@#][^\s@#,\uFF0C\u3002.!\uFF01?\uFF1F)\uFF09]{1,40})/g, lead: true },
];

/** Replace every opaque span with a numbered placeholder; `slots[n]` is what ⟦n⟧ stands for. */
export function protect(text: string, format: FieldFormat): { text: string; slots: string[] } {
  const slots: string[] = [];
  let out = text;
  for (const rule of format === 'md' ? PROTECT_RULES : PLAIN_RULES) {
    out = out.replace(rule.re, (match: string, g1: unknown, g2: unknown) => {
      // A span that is already a placeholder stays as it is.
      if (/^\u27E6\d+\u27E7$/.test(match)) return match;
      const lead = rule.lead && typeof g1 === 'string' ? g1 : '';
      const body = rule.lead && typeof g2 === 'string' ? g2 : match;
      slots.push(body);
      return `${lead}${PH_OPEN}${slots.length - 1}${PH_CLOSE}`;
    });
  }
  return { text: out, slots };
}

/** Put the slots back. null when the reply's placeholders are not EXACTLY the unit's (each once, none extra). */
export function restore(reply: string, slots: string[]): string | null {
  // Tolerate the harmless deformations models make: spaces inside the brackets, full-width digits.
  let tidy = reply.replace(/\u27E6\s*([0-9\uFF10-\uFF19]+)\s*\u27E7/g, (_m, d: string) => {
    const ascii = d.replace(/[\uFF10-\uFF19]/g, (c) => String(c.charCodeAt(0) - 0xff10));
    return `${PH_OPEN}${ascii}${PH_CLOSE}`;
  });
  // A link destination must touch its `]` — close a gap the model opened (`[texte] ⟦3⟧`).
  tidy = tidy.replace(/\]\s+\u27E6(\d+)\u27E7/g, (m, d: string) => {
    const slot = slots[Number(d)];
    return slot && (slot.startsWith('(') || slot.startsWith('[')) ? `]${PH_OPEN}${d}${PH_CLOSE}` : m;
  });
  const seen = new Set<number>();
  let bad = false;
  const out = tidy.replace(PH_RE, (_m, d: string) => {
    const i = Number(d);
    if (!Number.isInteger(i) || i < 0 || i >= slots.length || seen.has(i)) {
      bad = true;
      return '';
    }
    seen.add(i);
    return slots[i];
  });
  if (bad || seen.size !== slots.length) return null;
  // A stray bracket in the REPLY (not part of a valid placeholder) is a mangled slot. Checked on the
  // reply, not on the output: a slot may legitimately restore a literal bracket from the source.
  const leftovers = tidy.replace(PH_RE, '');
  if (leftovers.includes(PH_OPEN) || leftovers.includes(PH_CLOSE)) return null;
  return out;
}

// ── segmentation ─────────────────────────────────────────────────────────────

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const TOKEN_LINE_RE = /^ {0,3}\\?\[(?:poll|embed):[^\]\n]+\\?\][ \t]*$/;
const IMAGE_ONLY_RE = /^\s*(?:!\[[^\]\n]*\]\([^)\n]*\)\s*)+$/;
const HTML_ONLY_RE = /^\s*(?:<\/?[a-zA-Z][^<>\n]*>\s*)+$/;
const RULE_RE = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|=+)[ \t]*$/;
const TABLE_ALIGN_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const INDENTED_CODE_RE = /^(?: {4}|\t)/;
const LINK_DEF_RE = /^ {0,3}\[[^\]\n]+\]:\s+\S+/;
/** `> > - [ ] ` / `### ` / `12. ` — every structural marker a line can open with. */
const PREFIX_RE = /^(\s*(?:>[ \t]?)*\s*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d{1,9}[.)][ \t]+)?)/;

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.length > 1 && t.indexOf('|', 1) > 0;
}

/** Split a table row into `|`-delimited cells, honouring `\|`. Returns the pieces INCLUDING the pipes so a join is exact. */
function splitRow(line: string): string[] {
  const parts: string[] = [];
  let buf = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length) {
      buf += ch + line[i + 1];
      i++;
    } else if (ch === '|') {
      parts.push(buf, '|');
      buf = '';
    } else buf += ch;
  }
  parts.push(buf);
  return parts;
}

/** Cut an over-long unit at sentence ends so each piece fits MAX_BLOCK_CHARS. */
function splitLong(text: string): string[] {
  if (text.length <= MAX_BLOCK_CHARS) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_BLOCK_CHARS) {
    const window = rest.slice(0, MAX_BLOCK_CHARS);
    // The LAST sentence end in the window; never inside a placeholder-to-be (we split before protecting,
    // so avoid cutting inside (), [] or `` by refusing a cut that leaves them unbalanced).
    let cut = -1;
    const re = /[。！？!?；;](?=\s|$|[^\s])|\.(?=\s)|\n/g;
    for (let m = re.exec(window); m; m = re.exec(window)) {
      const at = m.index + m[0].length;
      const head = window.slice(0, at);
      const balanced =
        (head.match(/\(/g)?.length ?? 0) === (head.match(/\)/g)?.length ?? 0) &&
        (head.match(/\[/g)?.length ?? 0) === (head.match(/\]/g)?.length ?? 0) &&
        (head.match(/`/g)?.length ?? 0) % 2 === 0 &&
        (head.match(/</g)?.length ?? 0) === (head.match(/>/g)?.length ?? 0);
      if (balanced && at > MAX_BLOCK_CHARS * 0.3) cut = at;
    }
    if (cut < 0) return [text]; // no safe cut — the caller decides (opaque past MAX_OPAQUE_BLOCK_CHARS)
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

class Builder {
  chunks: Chunk[] = [];
  units: Unit[] = [];
  skipped = 0;
  constructor(private format: FieldFormat) {}

  opaque(raw: string): void {
    if (!raw) return;
    const last = this.chunks[this.chunks.length - 1];
    if (last && last.unit === undefined) last.raw += raw;
    else this.chunks.push({ raw });
  }

  /** `prefix + body + suffix` is the exact source; only `body` is offered to the model. */
  text(prefix: string, body: string, suffix: string, singleLine: boolean): void {
    // Whitespace at the edges belongs to the structure, not to the sentence.
    const lead = /^\s*/.exec(body)?.[0] ?? '';
    const trail = /\s*$/.exec(body.slice(lead.length))?.[0] ?? '';
    const core = body.slice(lead.length, body.length - trail.length);
    if (!core || !hasTranslatableText(core)) {
      this.opaque(prefix + body + suffix);
      return;
    }
    const pieces = splitLong(core);
    if (pieces.some((p) => p.length > MAX_OPAQUE_BLOCK_CHARS) || (pieces.length === 1 && core.length > MAX_BLOCK_CHARS * 2)) {
      this.skipped++;
      this.opaque(prefix + body + suffix);
      return;
    }
    pieces.forEach((piece, i) => {
      const pLead = /^\s*/.exec(piece)?.[0] ?? '';
      const pTrail = /\s*$/.exec(piece.slice(pLead.length))?.[0] ?? '';
      const pCore = piece.slice(pLead.length, piece.length - pTrail.length);
      const before = (i === 0 ? prefix + lead : '') + pLead;
      const after = pTrail + (i === pieces.length - 1 ? trail + suffix : '');
      if (!pCore || !hasTranslatableText(pCore)) {
        this.opaque(before + pCore + after);
        return;
      }
      const prot = protect(pCore, this.format);
      if (!hasTranslatableText(prot.text)) {
        this.opaque(before + pCore + after);
        return;
      }
      const unit: Unit = { index: this.units.length, source: pCore, protectedText: prot.text, slots: prot.slots, singleLine };
      this.units.push(unit);
      this.chunks.push({ raw: before + pCore + after, unit: unit.index, prefix: before, suffix: after });
    });
  }
}

function segmentMarkdown(text: string, b: Builder): void {
  // Keep every line's own terminator so the join is exact.
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let fence: { char: string; len: number } | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length === 0) return;
    // A paragraph = consecutive plain lines (soft-wrapped prose): ONE unit, for cross-sentence context.
    const joined = para.join('');
    const nl = joined.endsWith('\n') ? '\n' : '';
    b.text('', nl ? joined.slice(0, -1) : joined, nl, false);
    para = [];
  };

  for (const line of lines) {
    const body = line.endsWith('\n') ? line.slice(0, -1) : line;
    const nl = line.endsWith('\n') ? '\n' : '';

    const fm = FENCE_RE.exec(body);
    if (fm) {
      flushPara();
      const char = fm[1][0];
      const len = fm[1].length;
      if (!fence) fence = { char, len };
      else if (char === fence.char && len >= fence.len) fence = null;
      b.opaque(line);
      continue;
    }
    if (fence) {
      b.opaque(line);
      continue;
    }
    if (
      body.trim() === '' ||
      TOKEN_LINE_RE.test(body) ||
      IMAGE_ONLY_RE.test(body) ||
      HTML_ONLY_RE.test(body) ||
      RULE_RE.test(body) ||
      LINK_DEF_RE.test(body) ||
      (INDENTED_CODE_RE.test(body) && para.length === 0)
    ) {
      flushPara();
      b.opaque(line);
      continue;
    }
    if (isTableRow(body)) {
      flushPara();
      if (TABLE_ALIGN_RE.test(body)) {
        b.opaque(line);
        continue;
      }
      const parts = splitRow(body);
      parts.forEach((part, i) => {
        const last = i === parts.length - 1;
        if (part === '|') b.opaque(part + (last ? nl : ''));
        else b.text('', part, last ? nl : '', true);
      });
      if (parts.length === 0) b.opaque(nl);
      continue;
    }
    const prefix = PREFIX_RE.exec(body)?.[1] ?? '';
    if (prefix.trim() !== '') {
      // A marker line is its own unit: the marker stays ours, the rest is the sentence.
      flushPara();
      const heading = /#{1,6}[ \t]+$/.test(prefix);
      b.text(prefix, body.slice(prefix.length), nl, heading);
      continue;
    }
    para.push(line);
  }
  flushPara();
}

function segmentPlain(text: string, b: Builder): void {
  // Paragraphs split on blank lines; inner newlines are preserved inside the unit.
  const parts = text.split(/(\n[ \t]*\n+)/);
  for (const part of parts) {
    if (part === '') continue;
    if (/^\n[ \t]*\n+$/.test(part)) b.opaque(part);
    else b.text('', part, '', false);
  }
}

export function segment(text: string, format: FieldFormat): Segmented {
  const b = new Builder(format);
  if (format === 'title') b.text('', text, '', true);
  else if (format === 'plain') segmentPlain(text, b);
  else segmentMarkdown(text, b);
  return { chunks: b.chunks, units: b.units, skipped: b.skipped };
}

/**
 * Rebuild the field. `translated[unitIndex]` is the RESTORED translation of that
 * unit, or undefined to keep the original. Returns the text and how much of the
 * translatable material was covered.
 */
export function assemble(seg: Segmented, translated: ReadonlyMap<number, string>): { text: string; covered: number; total: number } {
  let covered = 0;
  const text = seg.chunks
    .map((c) => {
      if (c.unit === undefined) return c.raw;
      const t = translated.get(c.unit);
      if (t === undefined) return c.raw;
      covered++;
      return `${c.prefix ?? ''}${t}${c.suffix ?? ''}`;
    })
    .join('');
  return { text, covered, total: seg.units.length + seg.skipped };
}

/** What a unit is cached under: its RAW text (placeholders NOT substituted), whitespace-normalised. */
export function unitCacheSource(unit: Pick<Unit, 'source'>): string {
  return normalizeSource(unit.source);
}
