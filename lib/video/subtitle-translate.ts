// 字幕翻译 — the PURE half (no DB / env / provider): numbering, reply parsing and
// the retry → split → per-cue-fallback strategy, driven by an injected
// `complete(system, user)` so it is unit-testable with a fake model.
// lib/video/subtitles.ts binds it to the house LLM.
//
// Why it is more than "send 30 lines, read 30 lines": a long video is thousands
// of cues = dozens of sequential calls, and the original all-or-nothing loop
// returned null for the WHOLE track as soon as one reply came back with a
// merged or missing line — which, across 60 calls, is nearly every long video.
// Now a chunk is retried once, then split in half, down to single cues; a cue
// that still fails keeps its original text. Two breakers bound the cost when the
// model is simply down (consecutive request failures) or useless (too many
// fallbacks ⇒ a mostly-untranslated "English" track is worse than none).

import { stripReasoning } from '@/lib/skill-assist';
import type { SubtitleLang, VttCue } from './subtitles-shared';

export const TRANSLATE_CHUNK = 30;
const TRANSLATE_ATTEMPTS = 2;
/** Consecutive request FAILURES (not count mismatches) after which the whole translation is abandoned. */
export const TRANSLATE_MAX_CONSECUTIVE_ERRORS = 3;
/** Share of cues that may fall back to the original text before the track is judged not worth shipping. */
export const TRANSLATE_MAX_FALLBACK_RATIO = 0.3;

export type CompleteFn = (system: string, user: string) => Promise<string>;

/** `1. 译文` lines → Map(number → text). Tolerates `1、` / `1．` / `1)` and a reply wrapped in reasoning tags. */
export function parseNumberedLines(reply: string): Map<number, string> {
  const answer = stripReasoning(reply) ?? reply;
  const lines = new Map<number, string>();
  for (const raw of answer.split('\n')) {
    const m = /^\s*(\d+)\s*[.、．)]\s*(.+)$/.exec(raw.trim());
    if (m) lines.set(Number(m[1]), m[2].trim());
  }
  return lines;
}

interface TranslateState {
  consecutiveErrors: number;
  fallbacks: number;
  aborted: boolean;
}

async function translateTexts(texts: string[], system: string, complete: CompleteFn, state: TranslateState): Promise<string[]> {
  if (state.aborted) return texts;
  const numbered = texts.map((t, j) => `${j + 1}. ${t.replace(/\n/g, ' ')}`).join('\n');
  for (let attempt = 0; attempt < TRANSLATE_ATTEMPTS; attempt++) {
    try {
      const lines = parseNumberedLines(await complete(system, numbered));
      state.consecutiveErrors = 0;
      const out = texts.map((_, j) => lines.get(j + 1));
      if (out.every((l): l is string => typeof l === 'string' && l.length > 0)) return out;
    } catch {
      state.consecutiveErrors++;
      if (state.consecutiveErrors >= TRANSLATE_MAX_CONSECUTIVE_ERRORS) {
        state.aborted = true;
        return texts;
      }
    }
  }
  if (texts.length === 1) {
    state.fallbacks++;
    return texts; // keep the original line rather than drop the cue
  }
  const mid = Math.ceil(texts.length / 2);
  const head = await translateTexts(texts.slice(0, mid), system, complete, state);
  const tail = await translateTexts(texts.slice(mid), system, complete, state);
  return [...head, ...tail];
}

export function translateSystemPrompt(target: SubtitleLang): string {
  const targetName = target === 'zh' ? '简体中文' : 'English';
  return (
    `你是精准的字幕翻译引擎。把编号列表中的每一行字幕翻译成${targetName}。` +
    '保持行数与编号完全一致，每行格式为 "编号. 译文"，不要合并或拆分行。' +
    '保留专有名词、代码与数字的原文形态。不要输出任何解释。'
  );
}

/**
 * Translate cue texts to the target language, preserving count / order / timing.
 * null ⇒ the model is unreachable, or so unreliable that most lines fell back to
 * the original (the caller keeps only the original track).
 */
export async function translateCuesWith(cues: VttCue[], target: SubtitleLang, complete: CompleteFn): Promise<VttCue[] | null> {
  const system = translateSystemPrompt(target);
  const state: TranslateState = { consecutiveErrors: 0, fallbacks: 0, aborted: false };
  const out: VttCue[] = [];
  for (let i = 0; i < cues.length; i += TRANSLATE_CHUNK) {
    const chunk = cues.slice(i, i + TRANSLATE_CHUNK);
    const translated = await translateTexts(
      chunk.map((c) => c.text),
      system,
      complete,
      state,
    );
    if (state.aborted) return null;
    for (let j = 0; j < chunk.length; j++) {
      out.push({ start: chunk[j].start, end: chunk[j].end, text: translated[j] });
    }
  }
  if (cues.length > 0 && state.fallbacks / cues.length > TRANSLATE_MAX_FALLBACK_RATIO) return null;
  return out;
}
