// Deterministic chapter-text chunker for the 知识库 retrieval index. Pure
// module (no DB / env). Splits chapter plain text ('\n\n'-joined paragraphs)
// into retrieval chunks that are EXACT substrings of the input:
//   chunk.text === chapterText.slice(chunk.charStart, chunk.charEnd)
// so highlights / citations can always be re-anchored by offset.

export const CHUNKER_VERSION = 1;

const TARGET_TOKENS = 500;
const MAX_TOKENS = 800;
// Char window for the pathological single-sentence fallback (~750 CJK tokens).
const HARD_CUT_CHARS = 1200;

const CJK_RE = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힯]/g;
const LATIN_WORD_RE = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;
const TERMINATORS = new Set(['。', '！', '？', '.', '!', '?', '\n']);

/** ceil(cjkChars/1.6 + latinWords*1.3) — rough but stable across reruns. */
export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK_RE) ?? []).length;
  const latin = (text.replace(CJK_RE, ' ').match(LATIN_WORD_RE) ?? []).length;
  return Math.ceil(cjk / 1.6 + latin * 1.3);
}

export interface LibChunk {
  chapterIndex: number;
  ordinal: number;
  text: string;
  tokenEstimate: number;
  charStart: number;
  charEnd: number;
}

interface Span {
  start: number;
  end: number;
  tokens: number;
}

/** Trim a [start,end) span's whitespace edges; null when nothing remains. */
function trimSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return s < e ? { start: s, end: e } : null;
}

function toSpan(text: string, start: number, end: number): Span | null {
  const t = trimSpan(text, start, end);
  if (!t) return null;
  return { ...t, tokens: estimateTokens(text.slice(t.start, t.end)) };
}

/** Paragraph spans: blank-line ('\n\n') separated, whitespace-trimmed. */
function paragraphSpans(text: string): Span[] {
  const spans: Span[] = [];
  let offset = 0;
  for (const piece of text.split('\n\n')) {
    const span = toSpan(text, offset, offset + piece.length);
    if (span) spans.push(span);
    offset += piece.length + 2;
  }
  return spans;
}

/** Sentence spans within [start,end): cut after runs of 。！？.!?\n. */
function sentenceSpans(text: string, start: number, end: number): Span[] {
  const spans: Span[] = [];
  let s = start;
  let i = start;
  while (i < end) {
    if (TERMINATORS.has(text[i])) {
      let j = i + 1;
      while (j < end && TERMINATORS.has(text[j])) j++;
      const span = toSpan(text, s, j);
      if (span) spans.push(span);
      s = j;
      i = j;
    } else {
      i++;
    }
  }
  const tail = toSpan(text, s, end);
  if (tail) spans.push(tail);
  return spans;
}

/** Fixed char windows — last resort for a single monster sentence. */
function hardCutSpans(text: string, start: number, end: number): Span[] {
  const spans: Span[] = [];
  for (let s = start; s < end; s += HARD_CUT_CHARS) {
    const span = toSpan(text, s, Math.min(end, s + HARD_CUT_CHARS));
    if (span) spans.push(span);
  }
  return spans;
}

/**
 * Greedy packer: merge in-order spans (chunk = contiguous slice from the first
 * span's start to the last one's end, separators included verbatim) until the
 * target is reached or the max would be exceeded.
 */
function packSpans(text: string, spans: Span[], flushInto: Span[]): void {
  let current: Span | null = null;
  for (const span of spans) {
    if (!current) {
      current = { ...span };
      continue;
    }
    const mergedTokens = estimateTokens(text.slice(current.start, span.end));
    if (current.tokens >= TARGET_TOKENS || mergedTokens > MAX_TOKENS) {
      flushInto.push(current);
      current = { ...span };
    } else {
      current = { start: current.start, end: span.end, tokens: mergedTokens };
    }
  }
  if (current) flushInto.push(current);
}

export function chunkChapterText(chapterIndex: number, text: string): LibChunk[] {
  const packed: Span[] = [];
  let pending: Span[] = [];

  const flushPending = () => {
    if (pending.length > 0) {
      packSpans(text, pending, packed);
      pending = [];
    }
  };

  for (const para of paragraphSpans(text)) {
    if (para.tokens <= MAX_TOKENS) {
      pending.push(para);
      continue;
    }
    // Oversized paragraph: never merged with neighbours — hard-split at
    // sentence terminators (char windows if a single sentence still exceeds
    // the max) and packed on its own.
    flushPending();
    const pieces: Span[] = [];
    for (const sentence of sentenceSpans(text, para.start, para.end)) {
      if (sentence.tokens <= MAX_TOKENS) pieces.push(sentence);
      else pieces.push(...hardCutSpans(text, sentence.start, sentence.end));
    }
    packSpans(text, pieces, packed);
  }
  flushPending();

  return packed.map((span, ordinal) => {
    const chunkText = text.slice(span.start, span.end);
    return {
      chapterIndex,
      ordinal,
      text: chunkText,
      tokenEstimate: estimateTokens(chunkText),
      charStart: span.start,
      charEnd: span.end,
    };
  });
}
