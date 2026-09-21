// Server-side: generate + persist a video's AI summary. Runs at upload/publish,
// when an admin clicks "regenerate", from the demo backfill — and, since
// subtitles reached long videos, again once the subtitle pipeline has produced a
// transcript (refreshVideoSummaryIfStale), because THAT is the moment the
// summary can finally be about what was said rather than only the description.
// Pure prompt assembly stays in ai.ts.
//
// Returns null (no throw) when there's nothing to summarize. Propagates
// LLMConfigError so callers can decide: the create flow treats summary
// generation as best-effort, the admin regenerate maps it to 503.

import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { getProvider } from '@/lib/llm';
import { stripReasoning } from '@/lib/skill-assist';
import {
  buildVideoContext,
  buildVideoSummaryPrompt,
  hasAiGrounding,
  parseVideoSummary,
  videoContextSourceHash,
  type VideoAiInput,
} from '@/lib/video/ai';

/** Every column the AI context is built from — the chat route selects the same set. */
export const VIDEO_AI_SELECT = {
  id: true,
  title: true,
  descriptionMd: true,
  transcriptText: true,
  subtitleTranscript: true,
  durationSec: true,
  intervieweeName: true,
  intervieweeTitle: true,
  intervieweeOrg: true,
  intervieweeBio: true,
  aiSummaryMd: true,
  aiSummarySourceHash: true,
  tags: { select: { tag: { select: { name: true } } } },
} as const;

export function toVideoAiInput(v: {
  title: string;
  descriptionMd: string | null;
  transcriptText: string | null;
  subtitleTranscript: string | null;
  durationSec: number | null;
  intervieweeName: string | null;
  intervieweeTitle: string | null;
  intervieweeOrg: string | null;
  intervieweeBio: string | null;
  tags: { tag: { name: string } }[];
}): VideoAiInput {
  return {
    title: v.title,
    descriptionMd: v.descriptionMd,
    transcriptText: v.transcriptText,
    subtitleTranscript: v.subtitleTranscript,
    durationSec: v.durationSec,
    intervieweeName: v.intervieweeName,
    intervieweeTitle: v.intervieweeTitle,
    intervieweeOrg: v.intervieweeOrg,
    intervieweeBio: v.intervieweeBio,
    tags: v.tags.map((t) => t.tag.name),
  };
}

/** The context cap for this deploy (VIDEO_AI_CONTEXT_CHARS; lower it for a small-context model). */
export function videoAiContextChars(): number {
  return env.VIDEO_AI_CONTEXT_CHARS;
}

export interface SummaryResult {
  summaryMd: string;
  model: string;
}

export async function generateVideoSummary(
  videoId: string,
  locale?: string,
): Promise<SummaryResult | null> {
  const video = await prisma.video.findUnique({ where: { id: videoId }, select: VIDEO_AI_SELECT });
  if (!video) return null;

  const input = toVideoAiInput(video);
  if (!hasAiGrounding(input)) return null;

  const provider = getProvider(); // throws LLMConfigError if unconfigured

  const prompt = buildVideoSummaryPrompt(buildVideoContext(input, videoAiContextChars()), locale);
  const out = await provider.complete({
    system: prompt.system,
    messages: prompt.messages,
    // No maxTokens — see buildVideoSummaryPrompt.
  });
  // A server without a --reasoning-parser returns the <think> block inline; the
  // answer is whatever follows the LAST closing tag. null = the reply ended
  // inside the reasoning, i.e. there is no summary to store.
  const answer = stripReasoning(out.text);
  if (!answer) throw new Error('summary_empty');
  const summaryMd = parseVideoSummary(answer);

  await prisma.video.update({
    where: { id: videoId },
    data: {
      aiSummaryMd: summaryMd,
      aiSummaryModel: provider.model,
      aiSummaryAt: new Date(),
      aiSummarySourceHash: videoContextSourceHash(input),
    },
  });

  return { summaryMd, model: provider.model };
}

/**
 * Regenerate the summary ONLY when its inputs changed since it was written
 * (the stored source hash no longer matches) — what the subtitle pipeline calls
 * after it stores a transcript. NEVER throws: a missing LLM, a timeout or a
 * truncated reply must not turn a finished subtitle job into a failed one.
 * @returns true when a new summary was stored.
 */
export async function refreshVideoSummaryIfStale(videoId: string, locale?: string): Promise<boolean> {
  try {
    const video = await prisma.video.findUnique({ where: { id: videoId }, select: VIDEO_AI_SELECT });
    if (!video) return false;
    const input = toVideoAiInput(video);
    if (!hasAiGrounding(input)) return false;
    if (video.aiSummaryMd && video.aiSummarySourceHash === videoContextSourceHash(input)) return false;
    return (await generateVideoSummary(videoId, locale)) !== null;
  } catch {
    return false;
  }
}
