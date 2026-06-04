// Pure helpers for the video board's AI summary + chat. No DB / env / LLM
// imports — mirrors lib/skill-context.ts. The routes do the DB reads, call
// getProvider(), rate-limit, and stream; this file only assembles prompts so
// the cacheable prefix is byte-stable.

import { createHash } from 'node:crypto';

export interface VideoAiInput {
  title: string;
  descriptionMd?: string | null;
  transcriptText?: string | null;
  tags?: string[];
}

/** Cap the assembled context so the prompt stays within budget. */
const MAX_CONTEXT_CHARS = 120 * 1024;

/**
 * Assemble the video context in a FIXED order (TITLE -> TAGS -> DESCRIPTION ->
 * TRANSCRIPT) so the cacheable system prefix is identical across turns/users.
 */
export function buildVideoContext(input: VideoAiInput): string {
  const parts: string[] = [];
  parts.push(`# VIDEO TITLE\n${input.title.trim()}`);
  if (input.tags && input.tags.length > 0) {
    parts.push(`# TAGS\n${input.tags.join(', ')}`);
  }
  const desc = (input.descriptionMd ?? '').trim();
  if (desc) parts.push(`# DESCRIPTION\n${desc}`);
  const transcript = (input.transcriptText ?? '').trim();
  if (transcript) parts.push(`# TRANSCRIPT\n${transcript}`);
  let context = parts.join('\n\n');
  if (context.length > MAX_CONTEXT_CHARS) {
    context = context.slice(0, MAX_CONTEXT_CHARS) + '\n\n[...truncated...]';
  }
  return context;
}

/** True when there is enough material for a meaningful AI summary/chat. */
export function hasAiGrounding(input: VideoAiInput): boolean {
  return Boolean((input.descriptionMd ?? '').trim() || (input.transcriptText ?? '').trim());
}

/**
 * Stable hash of the inputs that determine the summary. When this changes
 * (title/description/transcript edited), the cached summary is invalidated.
 */
export function videoContextSourceHash(input: VideoAiInput): string {
  const basis = JSON.stringify({
    t: input.title.trim(),
    d: (input.descriptionMd ?? '').trim(),
    x: (input.transcriptText ?? '').trim(),
  });
  return createHash('sha256').update(basis).digest('hex');
}

/** Instruction appended so the model answers in the UI language. */
export function aiLanguageInstruction(locale: string | undefined): string {
  return locale && locale.toLowerCase().startsWith('en')
    ? 'Respond in English.'
    : '请用简体中文回答。';
}

export interface SummaryPrompt {
  system: string;
  messages: { role: 'user'; content: string }[];
  maxTokens: number;
}

export function buildVideoSummaryPrompt(context: string, locale?: string): SummaryPrompt {
  const system = [
    'You write concise, accurate summaries of a single interview/talk video for a tech (AI) community.',
    'You are given the video metadata below. Summarize ONLY what it contains; do not invent facts.',
    aiLanguageInstruction(locale),
    '',
    'Produce Markdown with: a one-sentence hook; 3-6 bullet "关键看点 / Key points"; and an optional "适合谁看 / Who should watch" line. Keep it under ~180 words.',
    '',
    '--- VIDEO CONTEXT ---',
    context,
  ].join('\n');
  return {
    system,
    messages: [{ role: 'user', content: 'Summarize this video.' }],
    maxTokens: 700,
  };
}

/** System prompt for the "ask about this video" chat. */
export function buildVideoChatSystem(context: string, summaryMd: string | null | undefined, locale?: string): string {
  return [
    'You are an assistant answering questions about ONE specific video for a tech (AI) community.',
    'Ground every answer in the VIDEO CONTEXT (and SUMMARY) below.',
    'If the video does not cover something, say you do not know rather than guessing.',
    aiLanguageInstruction(locale),
    '',
    '--- VIDEO CONTEXT ---',
    context,
    summaryMd ? `\n--- SUMMARY ---\n${summaryMd}` : '',
  ].join('\n');
}

/** Trim/clamp a generated summary before persisting. */
export function parseVideoSummary(text: string): string {
  const trimmed = text.trim();
  const MAX = 8 * 1024;
  return trimmed.length > MAX ? trimmed.slice(0, MAX) : trimmed;
}
