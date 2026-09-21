// Pure helpers for the video board's AI summary + chat. No DB / env / LLM
// imports — mirrors lib/skill-context.ts. The routes do the DB reads, call
// getProvider(), rate-limit, and stream; this file only assembles prompts so
// the cacheable prefix is byte-stable.
//
// GROUNDING = what the author wrote (title, tags, 简介 descriptionMd, 嘉宾) +
// what was SAID in the video (the transcript). The transcript is the manual
// `transcriptText` when the uploader pasted one, otherwise the timestamped text
// the subtitle pipeline derived from the source-language track
// (Video.subtitleTranscript, lib/video/transcript.ts) — so a video with
// generated subtitles gets a summary and a chat grounded in its actual content
// without anyone typing anything.

import { createHash } from 'node:crypto';
import { hasStamps } from './transcript';

export interface VideoAiInput {
  title: string;
  descriptionMd?: string | null;
  /** Manual transcript (the uploader's own). Wins over `subtitleTranscript`. */
  transcriptText?: string | null;
  /** Transcript derived from the subtitle track, `[m:ss]`-stamped paragraphs. */
  subtitleTranscript?: string | null;
  tags?: string[];
  intervieweeName?: string | null;
  intervieweeTitle?: string | null;
  intervieweeOrg?: string | null;
  intervieweeBio?: string | null;
  durationSec?: number | null;
}

/** Default cap on the assembled context; an operator with a small-context model lowers it (VIDEO_AI_CONTEXT_CHARS). */
export const DEFAULT_MAX_CONTEXT_CHARS = 120 * 1024;
/** The author's own words are never squeezed below this by a long transcript. */
const MIN_TRANSCRIPT_BUDGET = 4 * 1024;

export const CONTEXT_TRUNCATED_MARK = '[...truncated...]';

/** The transcript the AI reads: the uploader's own when present, else the subtitle-derived one. */
export function effectiveTranscript(input: VideoAiInput): string {
  const manual = (input.transcriptText ?? '').trim();
  return manual || (input.subtitleTranscript ?? '').trim();
}

/** Cut at the last paragraph (else line) boundary that fits, so a stamp is never split from its text. */
function truncateAtBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.max(0, max));
  const para = head.lastIndexOf('\n\n');
  const line = head.lastIndexOf('\n');
  const cut = para > max * 0.5 ? para : line > max * 0.5 ? line : head.length;
  return `${head.slice(0, cut).trimEnd()}\n\n${CONTEXT_TRUNCATED_MARK}`;
}

function formatDurationLine(sec: number): string {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * Assemble the video context in a FIXED order (TITLE -> DURATION -> TAGS ->
 * SPEAKER -> DESCRIPTION -> TRANSCRIPT) so the cacheable system prefix is
 * identical across turns/users.
 *
 * Only the TRANSCRIPT is ever truncated: it is the one unbounded part, and a
 * blind slice of the whole string used to be able to cut the author's
 * description in favour of nothing. It is cut at a paragraph boundary.
 */
export function buildVideoContext(input: VideoAiInput, maxChars: number = DEFAULT_MAX_CONTEXT_CHARS): string {
  const parts: string[] = [];
  parts.push(`# VIDEO TITLE\n${input.title.trim()}`);
  if (input.durationSec && input.durationSec > 0) {
    parts.push(`# DURATION\n${formatDurationLine(input.durationSec)}`);
  }
  if (input.tags && input.tags.length > 0) {
    parts.push(`# TAGS\n${input.tags.join(', ')}`);
  }
  const speaker = [
    [input.intervieweeName, input.intervieweeTitle, input.intervieweeOrg]
      .map((s) => (s ?? '').trim())
      .filter(Boolean)
      .join(' · '),
    (input.intervieweeBio ?? '').trim(),
  ]
    .filter(Boolean)
    .join('\n');
  if (speaker) parts.push(`# SPEAKER / GUEST\n${speaker}`);
  const desc = (input.descriptionMd ?? '').trim();
  if (desc) parts.push(`# DESCRIPTION (written by the uploader)\n${desc}`);

  const transcript = effectiveTranscript(input);
  if (transcript) {
    const heading = hasStamps(transcript)
      ? '# TRANSCRIPT (speech-to-text of the video; each paragraph starts with its [m:ss] timestamp; may contain recognition errors)'
      : '# TRANSCRIPT';
    const used = parts.join('\n\n').length + heading.length + 4;
    const budget = Math.max(MIN_TRANSCRIPT_BUDGET, maxChars - used);
    parts.push(`${heading}\n${truncateAtBoundary(transcript, budget)}`);
  }
  return parts.join('\n\n');
}

/** True when there is enough material for a meaningful AI summary/chat. */
export function hasAiGrounding(input: VideoAiInput): boolean {
  return Boolean((input.descriptionMd ?? '').trim() || effectiveTranscript(input));
}

/**
 * Stable hash of the inputs that determine the summary. When this changes
 * (title/description/speaker/transcript edited, or subtitles arrived), the
 * cached summary is stale.
 */
export function videoContextSourceHash(input: VideoAiInput): string {
  const basis = JSON.stringify({
    t: input.title.trim(),
    d: (input.descriptionMd ?? '').trim(),
    x: effectiveTranscript(input),
    g: [input.intervieweeName, input.intervieweeTitle, input.intervieweeOrg, input.intervieweeBio]
      .map((s) => (s ?? '').trim())
      .join('\u0001'),
  });
  return createHash('sha256').update(basis).digest('hex');
}

/** Instruction appended so the model answers in the UI language. */
export function aiLanguageInstruction(locale: string | undefined): string {
  const l = (locale ?? '').toLowerCase();
  if (l.startsWith('en')) return 'Respond in English.';
  if (l.startsWith('fr')) return 'Réponds en français.';
  return '请用简体中文回答。';
}

export interface SummaryPrompt {
  system: string;
  messages: { role: 'user'; content: string }[];
}

/**
 * NO maxTokens on purpose (house rule, see docs/contracts/platform.md): the
 * intranet default is a reasoning model, and a 700-token cap was spent inside
 * `<think>` — the stored "summary" was a truncated chain of thought or nothing.
 * The length is steered by the prompt instead; the OpenAI-compatible provider
 * omits the field when unset and Anthropic keeps its own generous default.
 */
export function buildVideoSummaryPrompt(context: string, locale?: string): SummaryPrompt {
  const stamped = hasStamps(context);
  const system = [
    'You write concise, accurate summaries of a single interview/talk video for a tech (AI) community.',
    'You are given the video metadata' + (stamped ? ' and a timestamped transcript' : '') + ' below. Summarize ONLY what it contains; do not invent facts.',
    'The DESCRIPTION is the uploader\'s own framing of the video — respect it; the TRANSCRIPT is what was actually said — prefer it for specifics. Transcripts come from speech recognition: silently fix obvious mis-hearings of names and terms using the title, tags and description.',
    aiLanguageInstruction(locale),
    '',
    'Produce Markdown with: a one-sentence hook; 3-6 bullet "关键看点 / Key points"; and an optional "适合谁看 / Who should watch" line. Keep that part under ~200 words.',
    stamped
      ? 'Then add a section "时间线 / Timeline" with 4-8 entries, one per line, each formatted exactly as `- [m:ss] what happens there` using timestamps that appear in the transcript (use [h:mm:ss] past one hour). Pick the moments a viewer would want to jump to.'
      : '',
    'Output the summary only — no preamble, no closing remarks.',
    '',
    '--- VIDEO CONTEXT ---',
    context,
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
  return {
    system,
    messages: [{ role: 'user', content: 'Summarize this video.' }],
  };
}

/** System prompt for the "ask about this video" chat. */
export function buildVideoChatSystem(context: string, summaryMd: string | null | undefined, locale?: string): string {
  const stamped = hasStamps(context);
  return [
    'You are an assistant answering questions about ONE specific video for a tech (AI) community.',
    'Ground every answer in the VIDEO CONTEXT (and SUMMARY) below.',
    'If the video does not cover something, say you do not know rather than guessing.',
    stamped
      ? 'The transcript paragraphs start with [m:ss] timestamps. When you refer to a specific moment, cite it inline in exactly that form, e.g. [12:34] — the page turns it into a link that jumps the player there. Only cite timestamps that appear in the transcript.'
      : '',
    aiLanguageInstruction(locale),
    '',
    '--- VIDEO CONTEXT ---',
    context,
    summaryMd ? `\n--- SUMMARY ---\n${summaryMd}` : '',
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

/** Trim/clamp a generated summary before persisting. */
export function parseVideoSummary(text: string): string {
  const trimmed = text.trim();
  const MAX = 8 * 1024;
  return trimmed.length > MAX ? trimmed.slice(0, MAX) : trimmed;
}
