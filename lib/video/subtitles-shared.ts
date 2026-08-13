// 字幕 pure helpers — no DB / env / LLM imports (unit tests import this module;
// the pipeline in lib/video/subtitles.ts composes these with the server-only
// pieces).

export interface VttCue {
  start: string; // "00:00:01.000"
  end: string;
  text: string;
}

/** Minimal WebVTT cue parser (timestamps + text; settings/notes dropped). */
export function parseVtt(vtt: string): VttCue[] {
  const cues: VttCue[] = [];
  const blocks = vtt.replace(/\r/g, '').split(/\n\n+/);
  const TIME = /(\d{1,2}:)?\d{2}:\d{2}\.\d{3}/;
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    const timeIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeIdx < 0) continue;
    const m = lines[timeIdx].split('-->');
    const start = m[0]?.match(TIME)?.[0];
    const end = m[1]?.match(TIME)?.[0];
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
