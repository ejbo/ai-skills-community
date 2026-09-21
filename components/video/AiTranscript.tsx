'use client';

// 文稿 tab — the subtitle track as readable, timestamped paragraphs. Click a stamp
// to jump the player there; the paragraph being spoken is highlighted and kept in
// view while the video plays (unless the reader has just scrolled by hand — then
// we leave them alone for a few seconds). The same paragraphs, serialised, are what
// the AI summary and chat read as background (lib/video/transcript.ts).
//
// Content-only: the fixed-height container + the tab title live in AiPanel. It
// stays mounted while another tab is showing, so `active` gates the follow-along
// work instead of unmounting it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cuesToParagraphs, formatStamp, paragraphIndexAt } from '@/lib/video/transcript';
import { useSubtitleCues } from './player/useSubtitleCues';
import { latestTime, onTime, requestSeek } from './player/watch-bus';

const HANDS_OFF_MS = 4000;

export function AiTranscript({ zhUrl, enUrl, active }: { zhUrl: string | null; enUrl: string | null; active: boolean }) {
  const t = useTranslations('video');
  const locale = useLocale();
  const both = Boolean(zhUrl && enUrl);
  const [lang, setLang] = useState<'zh' | 'en'>(() => (zhUrl && (!enUrl || locale.toLowerCase().startsWith('zh')) ? 'zh' : 'en'));
  const url = lang === 'zh' ? zhUrl ?? enUrl : enUrl ?? zhUrl;
  // Only fetch once the tab has actually been opened.
  const [opened, setOpened] = useState(active);
  useEffect(() => {
    if (active) setOpened(true);
  }, [active]);
  const cues = useSubtitleCues(opened ? url : null);
  const paragraphs = useMemo(() => (cues ? cuesToParagraphs(cues) : []), [cues]);

  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => paragraphs.map((p, index) => ({ ...p, index })).filter((p) => !q || p.text.toLowerCase().includes(q)),
    [paragraphs, q],
  );

  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    if (!active || paragraphs.length === 0) return;
    const sync = (sec: number) => setCurrent((prev) => {
      const next = paragraphIndexAt(paragraphs, sec);
      return next === prev ? prev : next;
    });
    sync(latestTime());
    return onTime(sync);
  }, [active, paragraphs]);

  // Follow along inside OUR scroller only (scrollIntoView would move the page too).
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lastManualScroll = useRef(0);
  const programmatic = useRef(false);
  useEffect(() => {
    if (!active || q || current < 0) return;
    if (Date.now() - lastManualScroll.current < HANDS_OFF_MS) return;
    const box = scrollerRef.current;
    const row = box?.querySelector<HTMLElement>(`[data-p="${current}"]`);
    if (!box || !row) return;
    const top = row.offsetTop - box.clientHeight / 3;
    programmatic.current = true;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    const id = setTimeout(() => (programmatic.current = false), 600);
    return () => clearTimeout(id);
  }, [current, active, q]);

  const segBtn = (on: boolean) =>
    `h-7 rounded-md px-2.5 text-xs font-medium transition-colors ${
      on ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900' : 'text-muted hover:text-zinc-900 dark:hover:text-zinc-100'
    }`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, 80))}
            placeholder={t('ai.transcript_search')}
            aria-label={t('ai.transcript_search')}
            className="h-8 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-xs focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900"
          />
        </label>
        {both && (
          <div className="flex shrink-0 rounded-lg border border-zinc-200 p-0.5 dark:border-zinc-800" role="group" aria-label={t('player.sub_language')}>
            <button type="button" aria-pressed={lang === 'zh'} onClick={() => setLang('zh')} className={segBtn(lang === 'zh')}>
              {t('player.sub_zh')}
            </button>
            <button type="button" aria-pressed={lang === 'en'} onClick={() => setLang('en')} className={segBtn(lang === 'en')}>
              EN
            </button>
          </div>
        )}
      </div>

      <div
        ref={scrollerRef}
        onScroll={() => {
          if (!programmatic.current) lastManualScroll.current = Date.now();
        }}
        className="relative min-h-0 flex-1 overflow-auto px-2 py-2"
      >
        {!cues ? (
          <div className="flex items-center gap-1.5 p-2 text-sm text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {t('ai.transcript_loading')}
          </div>
        ) : rows.length === 0 ? (
          <p className="p-2 text-sm text-muted">{q ? t('ai.transcript_no_match') : t('ai.transcript_empty')}</p>
        ) : (
          <ol className="space-y-0.5">
            {rows.map((p) => {
              const on = p.index === current;
              return (
                <li key={p.index} data-p={p.index}>
                  <button
                    type="button"
                    onClick={() => requestSeek(p.start)}
                    aria-current={on ? 'true' : undefined}
                    className={`flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 ${
                      on ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50' : 'text-zinc-600 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900'
                    }`}
                  >
                    <span className={`mt-px shrink-0 font-mono text-[11px] tabular-nums ${on ? 'font-semibold text-zinc-900 dark:text-zinc-50' : 'text-muted'}`}>
                      {formatStamp(p.start)}
                    </span>
                    <span className="min-w-0 flex-1" lang={lang === 'zh' ? 'zh-CN' : 'en'}>
                      {p.text}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
