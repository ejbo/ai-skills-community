// 字幕 pure helpers — no DB / env / LLM imports (unit tests AND client components
// import this module; the pipeline in lib/video/subtitles.ts composes these with
// the server-only pieces).

export interface VttCue {
  start: string; // "00:00:01.000"
  end: string;
  text: string;
}

/** A cue with numeric times (seconds) — what the player and the transcript work in. */
export interface TimedCue {
  start: number;
  end: number;
  text: string;
}

export type SubtitleLang = 'zh' | 'en';
export const SUBTITLE_LANGS: readonly SubtitleLang[] = ['zh', 'en'];

export function isSubtitleLang(v: unknown): v is SubtitleLang {
  return v === 'zh' || v === 'en';
}

// `mm:ss.mmm` and `hh:mm:ss.mmm`; SRT writes the millisecond separator as a comma.
const TIME = /(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

/** Minimal WebVTT cue parser (timestamps + text; settings/notes dropped). */
export function parseVtt(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = vtt.replace(/\r/g, '').split(/\n\n+/);
  const VTT_TIME = /(\d{1,2}:)?\d{2}:\d{2}\.\d{3}/;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const m = lines[timeIdx].split('-->');
    const start = m[0]?.match(VTT_TIME)?.[0];
    const end = m[1]?.match(VTT_TIME)?.[0];
    const text = lines
      .slice(timeIdx + 1)
      .join('\n')
      .trim();
    if (start && end && text) cues.push({ start, end, text });
  }
  return cues;
}

export function buildVtt(cues: VttCue[]): string {
  const body = cues.map((c) => `${c.start} --> ${c.end}\n${c.text}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** `hh:mm:ss.mmm` / `mm:ss.mmm` (or the SRT comma form) → seconds; null when it is not a timestamp. */
export function vttTimeToSeconds(time: string): number | null {
  const m = TIME.exec(time.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4].padEnd(3, '0'));
  if (min > 59 || s > 59) return null;
  return h * 3600 + min * 60 + s + ms / 1000;
}

/** Seconds → the canonical `hh:mm:ss.mmm` this module always writes. */
export function secondsToVttTime(sec: number): string {
  const total = Math.max(0, Math.round((Number.isFinite(sec) ? sec : 0) * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60_000) % 60;
  const h = Math.floor(total / 3_600_000);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}.${String(ms).padStart(3, '0')}`;
}

/** Cues with numeric times, sorted by start; cues whose times do not parse (or run backwards) are dropped. */
export function toTimedCues(cues: VttCue[]): TimedCue[] {
  const out: TimedCue[] = [];
  for (const c of cues) {
    const start = vttTimeToSeconds(c.start);
    const end = vttTimeToSeconds(c.end);
    if (start === null || end === null || end <= start) continue;
    out.push({ start, end, text: c.text });
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * Inline markup a cue may carry, reduced to plain text: WebVTT voice/class/ruby
 * spans (`<v Bob>`, `<c.loud>`, `<00:01.000>` karaoke stamps) and the `<i>/<b>/
 * <u>/<font>` tags SRT files are full of. We render cues as TEXT (never as
 * HTML), so without this a viewer would read the literal tags.
 */
export function stripCueMarkup(text: string): string {
  return text
    .replace(/<\/?(?:v|c|i|b|u|ruby|rt|lang|font)(?:[\s.][^>]*)?>/gi, '')
    .replace(/<\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3}>/g, '')
    .replace(/\{\\an?\d+\}/g, '') // ASS position overrides that leak into SRT
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export const SUBTITLE_FILE_MAX_BYTES = 2 * 1024 * 1024;
export const SUBTITLE_MAX_CUES = 20_000;

/**
 * Parse an uploaded subtitle file — WebVTT or SubRip (.srt), told apart by
 * CONTENT (an .srt renamed .vtt is common) — into canonical cues: times
 * re-written as `hh:mm:ss.mmm`, markup stripped, sorted, empty cues dropped.
 * null ⇒ nothing usable (not a subtitle file / no cues / too many cues).
 *
 * The output is always re-serialised through buildVtt, never stored verbatim:
 * the file route serves these as text/vtt on our origin, and a stored file is
 * exactly what this function emitted — timestamps and plain text lines.
 */
export function parseSubtitleFile(raw: string): VttCue[] | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.includes('-->')) return null;
  const cues: TimedCue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const [a, b] = lines[timeIdx].split('-->');
    const start = vttTimeToSeconds(a ?? '');
    const end = vttTimeToSeconds(b ?? '');
    if (start === null || end === null || end <= start) continue;
    const body = stripCueMarkup(
      lines
        .slice(timeIdx + 1)
        .filter((l) => l.trim() !== '')
        .join('\n'),
    );
    if (!body) continue;
    cues.push({ start, end, text: body });
    if (cues.length > SUBTITLE_MAX_CUES) return null;
  }
  if (cues.length === 0) return null;
  cues.sort((x, y) => x.start - y.start);
  return cues.map((c) => ({ start: secondsToVttTime(c.start), end: secondsToVttTime(c.end), text: c.text }));
}

/**
 * Indexes of the cues on screen at `time` (usually one; overlapping cues are
 * legal). Binary search to the last cue starting at or before `time`, then a
 * short walk back — cues are sorted by start and overlaps are rare and shallow,
 * so the walk is bounded instead of scanning the track.
 */
export function activeCueIndexes(cues: readonly TimedCue[], time: number): number[] {
  if (cues.length === 0 || !Number.isFinite(time)) return [];
  let lo = 0;
  let hi = cues.length - 1;
  let last = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= time) {
      last = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const out: number[] = [];
  for (let i = last; i >= 0 && i > last - 8; i--) {
    if (cues[i].end > time) out.unshift(i);
  }
  return out;
}

/** The text on screen at `time` (overlapping cues joined by a newline), '' when none. */
export function activeCueText(cues: readonly TimedCue[], time: number): string {
  return activeCueIndexes(cues, time)
    .map((i) => cues[i].text)
    .join('\n');
}

/** CJK code-point ratio over the non-whitespace characters of a string. */
export function cjkRatio(text: string): number {
  let cjk = 0;
  let total = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    total++;
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
  }
  return total === 0 ? 0 : cjk / total;
}

/**
 * Per-video language detection (每条视频单语: 中文视频 or 英文视频): decides
 * which side is the verbatim whisper track and which side the LLM translates.
 */
export function detectSubtitleLang(cues: VttCue[]): 'zh' | 'en' {
  return cjkRatio(cues.map((c) => c.text).join('')) > 0.12 ? 'zh' : 'en';
}
