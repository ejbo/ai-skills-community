// 字幕 → 文稿. Pure (no DB / env / LLM): turns a subtitle track into the
// timestamped plain-text transcript the AI reads as background
// (Video.subtitleTranscript → lib/video/ai.ts buildVideoContext), and formats /
// parses the `[mm:ss]` stamps that travel through it.
//
// Why paragraphs and not one line per cue: a cue is 2–5 s of speech, so a stamp
// per cue spends a third of the context budget on brackets and gives the model
// a wall of fragments. Cues are merged into paragraphs that each start with ONE
// stamp — a new paragraph opens on a real pause, or once the current one is long
// enough — which keeps the text readable, the stamps dense enough to cite
// ("[12:34] 讲到了 …") and the whole thing ~25 % smaller.
//
// The same stamp shape is what the UI turns into seek links
// (lib/video/timestamps.ts linkifyStamps), so the model can simply echo what it read.

import type { TimedCue } from './subtitles-shared';

export interface TranscriptOptions {
  /** A silence at least this long starts a new paragraph. */
  pauseSec?: number;
  /** A paragraph is closed once it spans this long… */
  maxParagraphSec?: number;
  /** …or holds this many characters. */
  maxParagraphChars?: number;
  /** Hard cap on the output; the transcript is cut at a paragraph boundary with a marker. */
  maxChars?: number;
}

const DEFAULTS: Required<TranscriptOptions> = {
  pauseSec: 2.5,
  maxParagraphSec: 45,
  maxParagraphChars: 420,
  maxChars: 200_000,
};

export const TRANSCRIPT_TRUNCATED_MARK = '[…文稿过长，后续内容已省略 / transcript truncated…]';

/** `m:ss` under an hour, `h:mm:ss` from there — the one stamp format the transcript, the AI and the UI share. */
export function formatStamp(sec: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Seconds for `m:ss` / `mm:ss` / `h:mm:ss`; null when the text is not a stamp (seconds/minutes ≥ 60, junk). */
export function parseStamp(text: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = m[1] !== undefined ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  if (s > 59 || (m[1] !== undefined && min > 59)) return null;
  return h * 3600 + min * 60 + s;
}

/** Latin words need a space between cues; CJK runs do not (and a stray space reads as a typo). */
function joiner(prev: string, next: string): string {
  const a = prev.slice(-1);
  const b = next.slice(0, 1);
  const cjk = /[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]/;
  return cjk.test(a) || cjk.test(b) ? '' : ' ';
}

export interface TranscriptParagraph {
  start: number;
  end: number;
  text: string;
}

/**
 * Merge cues into paragraphs (the 文稿 tab renders these; cuesToTranscript
 * serialises them for the AI).
 *
 * Consecutive cues with the same text are collapsed first: whisper loops on
 * silence and music ("谢谢观看" × 40), and that repetition would otherwise eat
 * the budget and teach the model that the speaker said it forty times.
 */
export function cuesToParagraphs(cues: readonly TimedCue[], options: TranscriptOptions = {}): TranscriptParagraph[] {
  const o = { ...DEFAULTS, ...options };
  const paragraphs: TranscriptParagraph[] = [];
  let start = 0;
  let end = 0;
  let text = '';
  let lastLine = '';

  const flush = () => {
    if (text) paragraphs.push({ start, end, text });
    text = '';
  };

  for (const cue of cues) {
    const line = cue.text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!line || line === lastLine) continue;
    lastLine = line;
    if (text && (cue.start - end >= o.pauseSec || cue.start - start >= o.maxParagraphSec || text.length >= o.maxParagraphChars)) {
      flush();
    }
    if (!text) {
      start = cue.start;
      text = line;
    } else {
      text += joiner(text, line) + line;
    }
    end = cue.end;
  }
  flush();
  return paragraphs;
}

/** `[m:ss] paragraph` lines separated by blank lines, capped at `maxChars` (cut at a paragraph boundary, with a marker). */
export function cuesToTranscript(cues: readonly TimedCue[], options: TranscriptOptions = {}): string {
  const o = { ...DEFAULTS, ...options };
  let out = '';
  for (const para of cuesToParagraphs(cues, o)) {
    const p = `[${formatStamp(para.start)}] ${para.text}`;
    const next = out ? `${out}\n\n${p}` : p;
    if (next.length > o.maxChars) {
      return out ? `${out}\n\n${TRANSCRIPT_TRUNCATED_MARK}` : `${p.slice(0, o.maxChars)}\n\n${TRANSCRIPT_TRUNCATED_MARK}`;
    }
    out = next;
  }
  return out;
}

/** Index of the paragraph being spoken at `time` (the last one that has started), -1 before the first. */
export function paragraphIndexAt(paragraphs: readonly TranscriptParagraph[], time: number): number {
  let lo = 0;
  let hi = paragraphs.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (paragraphs[mid].start <= time) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at;
}

/** True when a transcript carries `[m:ss]` stamps (so the prompts may ask the model to cite them). */
export function hasStamps(transcript: string | null | undefined): boolean {
  return !!transcript && /^\[\d{1,3}:\d{2}(?::\d{2})?\]/m.test(transcript);
}
