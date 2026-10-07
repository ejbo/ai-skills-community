'use client';

// 阅读语言 — the reader's 原文 / 中文 / English switch (owner, 2026-10-07).
//
// Its own chrome button rather than a section buried in Aa: reading a doc in
// another language is now the DEFAULT for cross-language docs, so getting back
// to 原文 (to highlight, or to check a sentence) must be one obvious click.
// The doc's own language never appears as a "translation" — it is 原文.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Languages, Loader2 } from 'lucide-react';
import type { ReaderTextChoice, TargetLang } from '@/lib/library/translation-shared';
import type { ReaderTranslationStatus } from '@/lib/library-queries';

export function LanguageMenu({
  choice,
  docLanguage,
  targetLangs,
  status,
  onChoose,
}: {
  choice: ReaderTextChoice;
  docLanguage: string | null;
  targetLangs: TargetLang[];
  status: Partial<Record<TargetLang, ReaderTranslationStatus>>;
  onChoose: (choice: ReaderTextChoice) => void;
}) {
  const t = useTranslations('reader');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nameOf = (lang: string | null) =>
    lang === 'zh' ? t('lang_zh') : lang === 'en' ? t('lang_en') : t('lang_unknown');
  const shortLabel = choice === 'original' ? t('text_original') : nameOf(choice);
  const options: { value: ReaderTextChoice; label: string; lang: TargetLang | null }[] = [
    {
      value: 'original',
      label: docLanguage ? t('lang_original_named', { lang: nameOf(docLanguage) }) : t('text_original'),
      lang: null,
    },
    ...targetLangs.map((l) => ({ value: l as ReaderTextChoice, label: nameOf(l), lang: l })),
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('lang_menu')}
        title={t('lang_menu')}
        className={`flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium transition ${
          open ? 'bg-accent-500/15 text-[var(--reader-accent)]' : 'r-muted hover:bg-[var(--reader-hover)]'
        }`}
      >
        <Languages className="h-4 w-4" />
        <span className="hidden sm:inline">{shortLabel}</span>
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t('lang_menu')}
          className="reader-panel rborder absolute right-0 top-11 z-50 w-60 rounded-xl border p-1.5 shadow-xl"
        >
          <p className="r-muted px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide">{t('lang_menu')}</p>
          {options.map((o) => {
            const st = o.lang ? status[o.lang]?.state : undefined;
            const active = o.value === choice;
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChoose(o.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition hover:bg-[var(--reader-hover)] ${
                  active ? 'font-medium' : ''
                }`}
              >
                <span className="grid h-4 w-4 shrink-0 place-items-center">
                  {active && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {st === 'running' && (
                  <span className="r-muted flex items-center gap-1 text-[11px]">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('lang_status_translating')}
                  </span>
                )}
                {st === 'failed' && <span className="r-muted text-[11px]">{t('lang_status_failed')}</span>}
              </button>
            );
          })}
          <p className="r-muted px-2.5 pb-1.5 pt-1 text-[11px] leading-relaxed">
            {t('lang_hint_auto')}
            {choice !== 'original' && <> {t('translate_marks_hidden')}</>}
          </p>
        </div>
      )}
    </div>
  );
}
