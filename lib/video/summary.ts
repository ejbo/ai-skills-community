// Server-side: generate + persist a video's AI summary ONCE (at upload/publish,
// or when an admin clicks "regenerate"). Reused by the create route, the admin
// regenerate route, and the demo backfill. Pure prompt assembly stays in ai.ts.
//
// Returns null (no throw) when there's nothing to summarize. Propagates
// LLMConfigError so callers can decide: the create flow treats summary
// generation as best-effort, the admin regenerate maps it to 503.

import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/llm';
import {
  buildVideoContext,
  buildVideoSummaryPrompt,
  hasAiGrounding,
  parseVideoSummary,
  videoContextSourceHash,
  type VideoAiInput,
} from '@/lib/video/ai';

const SELECT = {
  id: true,
  title: true,
  descriptionMd: true,
  transcriptText: true,
  tags: { select: { tag: { select: { name: true } } } },
} as const;

function toInput(v: {
  title: string;
  descriptionMd: string | null;
  transcriptText: string | null;
  tags: { tag: { name: string } }[];
}): VideoAiInput {
  return {
    title: v.title,
    descriptionMd: v.descriptionMd,
    transcriptText: v.transcriptText,
    tags: v.tags.map((t) => t.tag.name),
  };
}

export interface SummaryResult {
  summaryMd: string;
  model: string;
}

export async function generateVideoSummary(
  videoId: string,
  locale?: string,
): Promise<SummaryResult | null> {
  const video = await prisma.video.findUnique({ where: { id: videoId }, select: SELECT });
  if (!video) return null;

  const input = toInput(video);
  if (!hasAiGrounding(input)) return null;

  const provider = getProvider(); // throws LLMConfigError if unconfigured

  const prompt = buildVideoSummaryPrompt(buildVideoContext(input), locale);
  const out = await provider.complete({
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: prompt.maxTokens,
  });
  const summaryMd = parseVideoSummary(out.text);

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
