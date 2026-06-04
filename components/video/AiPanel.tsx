'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AiSummary } from './AiSummary';
import { AiChat } from './AiChat';

type Tab = 'summary' | 'chat';

export function AiPanel({ slug }: { slug: string }) {
  const t = useTranslations('video');
  const [tab, setTab] = useState<Tab>('summary');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'summary', label: t('ai.summary_title') },
    { key: 'chat', label: t('ai.chat_title') },
  ];

  return (
    <div className="surface flex h-[560px] flex-col overflow-hidden rounded-2xl">
      <div className="flex shrink-0 border-b border-zinc-100 dark:border-zinc-800">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            aria-selected={tab === tb.key}
            className={`relative flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              tab === tb.key
                ? 'text-zinc-900 dark:text-zinc-100'
                : 'text-muted hover:text-zinc-700 dark:hover:text-zinc-300'
            }`}
          >
            {tb.label}
            {tab === tb.key && (
              <span className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-zinc-900 dark:bg-zinc-100" />
            )}
          </button>
        ))}
      </div>

      {/* Both panes stay mounted so chat history + the summary fetch survive tab switches. */}
      <div className={tab === 'summary' ? 'min-h-0 flex-1' : 'hidden'}>
        <AiSummary slug={slug} />
      </div>
      <div className={tab === 'chat' ? 'min-h-0 flex-1' : 'hidden'}>
        <AiChat slug={slug} />
      </div>
    </div>
  );
}
