'use client';

import { AiSummary } from './AiSummary';
import { AiChat } from './AiChat';

export function AiPanel({ slug }: { slug: string }) {
  return (
    <div className="space-y-4">
      <AiSummary slug={slug} />
      <AiChat slug={slug} />
    </div>
  );
}
