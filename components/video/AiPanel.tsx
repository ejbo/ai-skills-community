'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AiSummary } from './AiSummary';
import { AiChat } from './AiChat';

type Tab = 'summary' | 'chat';

// Tabs + the two panes. Rendered both inline and inside the focus modal; each
// instance owns its own tab state (the summary is cached, so a second fetch is
// cheap, and the modal gives a fresh focused chat).
function AiPanelBody({ slug, action }: { slug: string; action: React.ReactNode }) {
  const t = useTranslations('video');
  const [tab, setTab] = useState<Tab>('summary');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'summary', label: t('ai.summary_title') },
    { key: 'chat', label: t('ai.chat_title') },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center border-b border-zinc-100 dark:border-zinc-800">
        <div className="flex flex-1">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              type="button"
              onClick={() => setTab(tb.key)}
              aria-selected={tab === tb.key}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${
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
        <div className="pr-2">{action}</div>
      </div>

      {/* Both stay mounted so chat history + the summary fetch survive tab switches. */}
      <div className={tab === 'summary' ? 'min-h-0 flex-1' : 'hidden'}>
        <AiSummary slug={slug} />
      </div>
      <div className={tab === 'chat' ? 'min-h-0 flex-1' : 'hidden'}>
        <AiChat slug={slug} />
      </div>
    </div>
  );
}

function IconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 place-items-center rounded-lg text-muted transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      {children}
    </button>
  );
}

export function AiPanel({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div className="surface flex h-[560px] flex-col overflow-hidden rounded-2xl lg:h-[700px]">
        <AiPanelBody
          slug={slug}
          action={
            <IconButton onClick={() => setOpen(true)} label="Expand">
              <Maximize2 className="h-4 w-4" />
            </IconButton>
          }
        />
      </div>

      {mounted &&
        open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
            role="dialog"
            aria-modal="true"
          >
            <div
              className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-sm"
              onClick={() => setOpen(false)}
            />
            <div className="surface relative z-10 flex h-[85vh] w-full max-w-3xl animate-slide-up flex-col overflow-hidden rounded-2xl shadow-2xl">
              <AiPanelBody
                slug={slug}
                action={
                  <IconButton onClick={() => setOpen(false)} label="Close">
                    <X className="h-4 w-4" />
                  </IconButton>
                }
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
