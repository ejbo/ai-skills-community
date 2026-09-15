// 图片粘连修复 — detect and repair bodies the old image serializer glued.
//
// Until the flow fix, the editor's block-image markdown serializer
// (components/RichTextEditor.tsx BasePathImage) wrote the image and never
// closed its block, so whatever block followed was written onto the SAME line:
//   ![a](/a.jpg)after            ← a paragraph
//   ![a](/a.jpg)## Heading       ← a heading, shown as literal "## Heading"
//   ![a](/a.jpg)| h |            ← a table, flattened on the next save
//   ![a](/a.jpg)[embed:file:…]   ← an embed card, which then vanishes
//   <img src="…" alt="…" width="320">after   ← the resized-image form
// CommonMark reads each of those as ONE paragraph, so the reader shows the
// following block as text next to the image, and re-opening + saving in the
// editor makes the damage permanent (`\## Heading`). Fixing the serializer
// does not repair rows already stored; scripts/repair-glued-images.ts runs
// this module over them — writing in place, with no backup — so every rule
// below errs on the side of SKIPPING: a missed repair leaves a body as it was,
// a wrong one silently rewrites what someone wrote on purpose.
//
// Pure and import-free except the sticker prefix. What counts as glue is
// deliberately NARROW — only the shape the serializer produced:
//  • the image STARTS a block the serializer writes: its line begins with it,
//    after an optional blockquote prefix, and either
//      – the line before is blank (or this is the first line), at top level; or
//      – it follows a list marker (`- `, `1. ` — the item's first child); or
//      – it is indented to EXACTLY the content column of a list item that is
//        still open (the item's next child, blank line before or not — a tight
//        list writes children on consecutive lines).
//    Indentation alone is NOT a container: a top-level line indented by
//    spaces is a hand-written paragraph, and one indented 4+ columns past its
//    container after a blank line is an INDENTED CODE BLOCK — skipped, like any
//    over-indented continuation line. `see ![a](x) here` is inline, and so is
//    `text⏎![a](x)more` — the plain comment box appends an image to the
//    paragraph that way — neither is touched;
//  • the image is in the exact form the serializer writes: `![alt](src)` with
//    an optional ` "title"`, or `<img src="…" alt="…"[ title="…"] width="N">`;
//  • the next character sits IMMEDIATELY after it and can begin a block or a
//    sentence. Whitespace (hand-written spacing), a trailing `\` (a hard
//    break), closing punctuation (`), . ，。` …) and HTML the serializer never
//    glues a block with — `<br>`, a closing tag (`</p>` of a hand-written
//    `<p align="center">` wrapper), `<!--`, `<?`, `<pre|script|style|textarea`
//    — are not glue. (A bare `<` still is: a paragraph that opens with a
//    formatting span, `<span data-color="red">`, or a resized `<img … width>`
//    in an image run, is exactly what the serializer glued.);
//  • the glued line is not the header of a structure the NEXT line completes:
//    a setext underline (`===` / `---`) makes it a heading, and a GFM delimiter
//    row with the same cell count makes it a table header — CommonMark already
//    renders the image INSIDE that heading / header cell, and the serializer
//    never wrote either shape (ATX headings, leading-pipe tables). The real
//    glued table, `![a](x)| h | g |` over `| --- | --- |`, always has one cell
//    too many, so it is still repaired;
//  • stickers (`/api/uploads/stickers/…`) are INLINE by design — text after one
//    is a sentence, never glue;
//  • verbatim regions are skipped: fenced code (a markdown tutorial may show
//    exactly this shape), indented code (above) and the HTML blocks whose
//    content is raw until an explicit closer — `<pre>`/`<script>`/`<style>`/
//    `<textarea>` (type 1), `<!-- -->`, `<? ?>`, `<!X >`, `<![CDATA[ ]]>`
//    (types 2–5). These run across blank lines, so they are tracked as state.
// The repair inserts a blank line after the image — `\n\n` at top level; inside
// a blockquote or list item the continuation prefix is repeated so the
// following block stays in its container.
//
// What the rules CANNOT tell apart is a list item whose first child is an
// image followed by a paragraph: the serializer wrote `- ![py](/py.png)Python`,
// and so does every README icon list. That ambiguity is why the target table
// below keeps fields whose bodies are not editor-authored OUT of the default
// run (GluedImageTarget.optIn).

import { STICKER_URL_PREFIX } from '@/lib/stickers';

/** `![alt](src "title")` exactly as BasePathImage serializes it (alt escaped, parens in src escaped). */
const MD_IMAGE_AT_START = /^!\[((?:[^\]\\\n]|\\.)*)\]\(((?:[^()\\\s]|\\.)*)(?: "(?:[^"\\\n]|\\.)*")?\)/;
/** `<img src="…" alt="…"[ title="…"] width="N">` exactly as BasePathImage serializes a resized image. */
const HTML_IMAGE_AT_START = /^<img src="([^"]*)" alt="[^"]*"(?: title="[^"]*")? width="\d+">/;

/** Blockquote markers, each with its optional following space. */
const QUOTE_PREFIX_RE = /^(?:[ \t]*>[ \t]?)*/;
/** A list marker and the whitespace after it (group 1: an ordered item's number). */
const LIST_MARKER_RE = /^(?:[-+*]|(\d{1,9})[.)])[ \t]+/;
const FENCE_RE = /^(`{3,}|~{3,})(.*)$/;
const SETEXT_UNDERLINE_RE = /^(?:=+|-+)[ \t]*$/;
const TABLE_DELIMITER_RE = /^\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** HTML blocks (CommonMark types 1–5) whose content is raw until the closer — blank lines included. */
const VERBATIM_HTML_BLOCKS: ReadonlyArray<{ open: RegExp; close: RegExp }> = [
  { open: /^<(?:pre|script|style|textarea)(?=[\s>]|$)/i, close: /<\/(?:pre|script|style|textarea)>/i },
  { open: /^<!--/, close: /-->/ },
  { open: /^<\?/, close: /\?>/ },
  { open: /^<!\[CDATA\[/, close: /\]\]>/ },
  { open: /^<![A-Za-z]/, close: />/ },
];

/**
 * What may directly follow an image WITHOUT being glue: whitespace, closing
 * punctuation, a lone `!`, a `\` that ends the line (a hard break), or HTML the
 * serializer never glued a block with (see the header). A `\` before
 * punctuation IS glue — the serializer escapes a following paragraph's leading
 * `*` / `[` / `_` exactly like that.
 */
const NOT_GLUE_START = /^(?:[\s),.;:?\]}，。；：？！、）】」』》…]|!(?!\[)|\\$|<br\b|<\/|<[!?]|<(?:pre|script|style|textarea)\b)/i;

export interface GluedImageOptions {
  /**
   * Also split an image glued to ANOTHER image (`![a](x)![b](y)`). On for
   * editor-authored bodies — two consecutive block images serialize exactly
   * like that. Turn it off for bodies that may be imported READMEs (skill
   * overviews), where a badge row is written that way on purpose.
   */
  splitImageRuns?: boolean;
}

export interface GluedImageResult {
  /** The repaired body (=== input when nothing was glued). */
  text: string;
  /** Number of image/next-block boundaries repaired. */
  fixes: number;
  /** Up to 3 short one-line excerpts around the repaired boundaries (`⏎` marks the split). */
  samples: string[];
}

interface ImageHit {
  length: number;
  sticker: boolean;
}

function imageAtStart(s: string): ImageHit | null {
  const md = MD_IMAGE_AT_START.exec(s);
  if (md) return { length: md[0].length, sticker: md[2].replace(/\\(.)/g, '$1').startsWith(STICKER_URL_PREFIX) };
  const html = HTML_IMAGE_AT_START.exec(s);
  if (html) return { length: html[0].length, sticker: html[1].startsWith(STICKER_URL_PREFIX) };
  return null;
}

/** Column reached after `ws`, starting at column `start` (a tab advances to the next multiple of 4). */
function columnAfter(ws: string, start: number): number {
  let col = start;
  for (const ch of ws) col = ch === '\t' ? col + 4 - (col % 4) : col + 1;
  return col;
}

interface LineParts {
  /** Blockquote markers (with their spaces). */
  quote: string;
  /** Number of `>` in `quote` — list columns are only comparable at the same depth. */
  depth: number;
  /** Whitespace between the quote prefix and the content (or marker). */
  indent: string;
  /** Visual width of `indent`. */
  cols: number;
  /** The list marker with its trailing whitespace, '' when none. */
  marker: string;
  /** An ordered marker's number, null for a bullet or no marker. */
  ordered: number | null;
  /** Content column a marker opens (CommonMark: ≥5 spaces after it means 1 + indented code). */
  contentCol: number;
  /** Everything after quote, indentation and marker. */
  rest: string;
}

function parseLine(line: string): LineParts {
  const quote = QUOTE_PREFIX_RE.exec(line)?.[0] ?? '';
  const afterQuote = line.slice(quote.length);
  const indent = /^[ \t]*/.exec(afterQuote)?.[0] ?? '';
  const cols = columnAfter(indent, 0);
  let rest = afterQuote.slice(indent.length);
  const m = LIST_MARKER_RE.exec(rest);
  let marker = '';
  let ordered: number | null = null;
  let contentCol = cols;
  if (m) {
    marker = m[0];
    ordered = m[1] !== undefined ? Number(m[1]) : null;
    const chars = marker.replace(/[ \t]+$/, '');
    const markerEnd = cols + chars.length;
    const contentEnd = columnAfter(marker.slice(chars.length), markerEnd);
    contentCol = contentEnd - markerEnd >= 5 ? markerEnd + 1 : contentEnd;
    rest = rest.slice(marker.length);
  }
  return { quote, depth: (quote.match(/>/g) ?? []).length, indent, cols, marker, ordered, contentCol, rest };
}

/**
 * A fence OPENER in a line's content. Deliberately generous (any indentation,
 * after a list marker): mistaking a line for a fence only means lines are
 * skipped (fewer repairs); missing a real fence could "repair" code.
 */
function fenceOpener(rest: string): { char: string; len: number } | null {
  const m = FENCE_RE.exec(rest);
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null; // ```a``` is inline code
  return { char: m[1][0], len: m[1].length };
}

/**
 * Does this line CLOSE the fence? Only the quote prefix and whitespace are
 * stripped — never a list marker: `- ```` inside a code block is content, and
 * reading it as a closer would let the rest of the code be "repaired".
 */
function closesFence(line: string, fence: { char: string; len: number }): boolean {
  const m = FENCE_RE.exec(line.slice((QUOTE_PREFIX_RE.exec(line)?.[0] ?? '').length).replace(/^[ \t]+/, ''));
  return !!m && m[1][0] === fence.char && m[1].length >= fence.len && m[2].trim() === '';
}

/** Cells of a GFM table row: unescaped pipes split it, one leading and one trailing pipe are borders. */
function tableCells(row: string): number {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  let cells = 1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (s[i] === '|') cells++;
  }
  return cells;
}

/** The glued line is a setext heading or a GFM table header, completed by the next line (see the header). */
function isHeaderOfNextLine(rest: string, nextRaw: string | undefined): boolean {
  if (nextRaw === undefined) return false;
  const next = nextRaw.replace(/\r$/, '').replace(QUOTE_PREFIX_RE, '').trim();
  if (SETEXT_UNDERLINE_RE.test(next)) return true;
  return next.includes('|') && TABLE_DELIMITER_RE.test(next) && tableCells(rest) === tableCells(next);
}

function sampleOf(image: string, after: string): string {
  const head = image.length > 40 ? `${image.slice(0, 18)}…${image.slice(-18)}` : image;
  return `${head}⏎${after.slice(0, 24)}`;
}

/** Split one block-start line at every glued image boundary. */
function repairLine(parts: LineParts, opts: Required<GluedImageOptions>, samples: string[]): { lines: string[]; fixes: number } {
  const line = parts.quote + parts.indent + parts.marker + parts.rest;
  const first = imageAtStart(parts.rest);
  if (!first || first.sticker) return { lines: [line], fixes: 0 };

  // Continuation inside the same container: the quote markers repeated, a list
  // marker replaced by spaces of its width (indentation is kept verbatim).
  const quoteCont = parts.quote.replace(/[ \t]+$/, '');
  const cont = (parts.quote ? `${quoteCont} ` : '') + (parts.indent + parts.marker).replace(/[^\t]/g, ' ');
  const blank = quoteCont;

  const out: string[] = [];
  let prefix = parts.quote + parts.indent + parts.marker;
  let rest = parts.rest;
  let fixes = 0;
  let hit: ImageHit | null = first;
  while (hit && !hit.sticker) {
    const image = rest.slice(0, hit.length);
    const after = rest.slice(hit.length);
    if (after === '' || NOT_GLUE_START.test(after)) break;
    const next = imageAtStart(after);
    if (next && !opts.splitImageRuns) break;
    out.push(prefix + image, blank);
    if (samples.length < 3) samples.push(sampleOf(image, after));
    fixes++;
    prefix = cont;
    rest = after;
    hit = next;
  }
  out.push(prefix + rest);
  return { lines: out, fixes };
}

/** Detect and repair glued images in one stored body. Idempotent: a repaired body reports 0 fixes. */
export function repairGluedImages(md: string, options: GluedImageOptions = {}): GluedImageResult {
  const opts: Required<GluedImageOptions> = { splitImageRuns: options.splitImageRuns ?? true };
  if (!md || (!md.includes('![') && !md.includes('<img '))) return { text: md, fixes: 0, samples: [] };

  const lines = md.split('\n');
  const out: string[] = [];
  const samples: string[] = [];
  let fixes = 0;
  let fence: { char: string; len: number } | null = null;
  /** The closer of an open verbatim HTML block (types 1–5). */
  let htmlClose: RegExp | null = null;
  // Was the previous line blank (container markers alone count as blank)? The
  // first line starts a block by definition.
  let afterBlank = true;
  /** Content columns of the list items still open, at blockquote depth `listDepth`. */
  let lists: number[] = [];
  let listDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    // Keep CRLF bodies CRLF: process without the `\r`, put it back on every emitted line.
    const rawLine = lines[i];
    const cr = rawLine.endsWith('\r') ? '\r' : '';
    const line = cr ? rawLine.slice(0, -1) : rawLine;

    if (fence) {
      if (closesFence(line, fence)) fence = null;
      out.push(rawLine);
      afterBlank = false;
      continue;
    }
    if (htmlClose) {
      if (htmlClose.test(line)) htmlClose = null;
      out.push(rawLine);
      afterBlank = false;
      continue;
    }

    const parts = parseLine(line);
    if (parts.depth !== listDepth) {
      lists = [];
      listDepth = parts.depth;
    }
    if (parts.rest.trim() === '') {
      out.push(rawLine);
      afterBlank = true;
      continue;
    }

    // List bookkeeping: a line indented less than an item's content column closes
    // that item. (CommonMark keeps the item open when such a line is a lazy
    // paragraph continuation — but the serializer indents every continuation, so
    // treating it as closed can only mean fewer repairs, never a wrong one.)
    lists = lists.filter((c) => c <= parts.cols);
    const base = lists.reduce((b, c) => (c <= parts.cols && c > b ? c : b), 0);
    // 4+ columns past the container: indented code after a blank line, or an
    // over-indented continuation line otherwise — never a block the serializer wrote.
    const indentedCode = parts.cols >= base + 4;
    // A marker opens an item unless it is paragraph text: an ordered list that
    // does not start at 1 cannot interrupt a paragraph (CommonMark).
    const opensItem =
      parts.marker !== '' &&
      !indentedCode &&
      !(!afterBlank && lists.length === 0 && parts.ordered !== null && parts.ordered !== 1);
    if (opensItem) {
      lists = lists.filter((c) => c <= parts.cols);
      lists.push(parts.contentCol);
    }

    const opener = fenceOpener(parts.rest);
    if (opener) {
      fence = opener;
      out.push(rawLine);
      afterBlank = false;
      continue;
    }
    const html = VERBATIM_HTML_BLOCKS.map((b) => ({ close: b.close, opened: b.open.exec(parts.rest) })).find((b) => b.opened);
    if (html?.opened) {
      // The closer may sit on the opening line itself (`<!-- note -->`, `<pre>x</pre>`).
      if (!html.close.test(parts.rest.slice(html.opened[0].length))) htmlClose = html.close;
      out.push(rawLine);
      afterBlank = false;
      continue;
    }

    const blockStart = indentedCode
      ? false
      : parts.marker !== ''
        ? opensItem
        : parts.cols === 0
          ? afterBlank
          : lists.includes(parts.cols);
    const repaired =
      blockStart && !isHeaderOfNextLine(parts.rest, lines[i + 1])
        ? repairLine(parts, opts, samples)
        : { lines: [line], fixes: 0 };
    afterBlank = false;
    fixes += repaired.fixes;
    for (const l of repaired.lines) out.push(l + cr);
    if (repaired.fixes > 0) {
      // The glued remainder is a block of its own now: it may open a fence
      // (`![a](x)```js` — the lines that follow are code) or a list item whose
      // next children are indented to its content column.
      const tail = parseLine(repaired.lines[repaired.lines.length - 1]);
      const tailFence = fenceOpener(tail.rest);
      if (tailFence) fence = tailFence;
      else if (tail.marker) {
        lists = lists.filter((c) => c <= tail.cols);
        lists.push(tail.contentCol);
      }
    }
  }

  return fixes === 0 ? { text: md, fixes: 0, samples: [] } : { text: out.join('\n'), fixes, samples };
}

// ── Where the repair runs ────────────────────────────────────────────────────

export interface GluedImageTarget {
  model: string;
  field: string;
  /** false where a body may be an imported README (badge rows are written `![a](x)![b](y)` on purpose). */
  splitImageRuns?: boolean;
  /**
   * Set (to the reason) for a field whose bodies are NOT reliably editor-authored.
   * Such a field is only scanned when named explicitly (`--only=Model.field`):
   * its hand-written markdown contains shapes the rules cannot tell from glue —
   * an icon list `- ![py](/py.png)Python`, an image typed straight after the
   * plain comment box's appended `![](url)`.
   */
  optIn?: string;
}

/**
 * Every stored markdown body the repair may touch. Not listed on purpose:
 * LibraryNoteReply / VoteComment / LibraryDoc.abstractMd (plain textareas),
 * Video.aiSummaryMd (model output), SkillComparison.bodyMd and
 * SkillVersion.changelogMd (not editor-authored). The 版块 right-rail custom
 * cards (`Zone.sidebar` JSON) are handled by the script separately.
 */
export const GLUED_IMAGE_TARGETS: readonly GluedImageTarget[] = [
  { model: 'ZonePost', field: 'bodyMd' },
  { model: 'ZonePostComment', field: 'bodyMd' },
  { model: 'ZoneWikiPage', field: 'bodyMd' },
  { model: 'ZoneWikiRevision', field: 'bodyMd' },
  { model: 'Zone', field: 'descriptionMd' },
  { model: 'DiscussionTopic', field: 'bodyMd' },
  { model: 'DiscussionReply', field: 'bodyMd' },
  { model: 'Post', field: 'bodyMd' },
  { model: 'PostComment', field: 'bodyMd' },
  { model: 'Event', field: 'descriptionMd' },
  { model: 'Announcement', field: 'bodyMd' },
  { model: 'Feedback', field: 'bodyMd' },
  { model: 'FeedbackComment', field: 'bodyMd' },
  {
    model: 'Skill',
    field: 'descriptionMd',
    splitImageRuns: false,
    optIn: 'stores the uploaded package README (app/api/skills/upload-package) — icon lists, badge rows and <p align> wrappers are written by hand',
  },
  { model: 'SkillPack', field: 'descriptionMd' },
  { model: 'Review', field: 'bodyMd' },
  { model: 'Video', field: 'descriptionMd' },
  {
    model: 'VideoComment',
    field: 'bodyMd',
    optIn: 'the default composer is a plain textarea that appends `![](url)` — text typed right after it looks exactly like glue',
  },
  { model: 'LibraryComment', field: 'bodyMd' },
  { model: 'VoteActivity', field: 'descriptionMd' },
  { model: 'UserProfile', field: 'aboutMd' },
];

export function gluedImageTargetLabel(t: GluedImageTarget): string {
  return `${t.model}.${t.field}`;
}

/** `--only` names the fields to scan (opt-in ones included); without it, every field that is not opt-in. */
export function selectGluedImageTargets(only: ReadonlySet<string> | null): GluedImageTarget[] {
  return GLUED_IMAGE_TARGETS.filter((t) => (only ? only.has(gluedImageTargetLabel(t)) : !t.optIn));
}
