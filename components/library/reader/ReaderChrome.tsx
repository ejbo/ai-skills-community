'use client';

import Link from 'next/link';
import { ArrowLeft, ExternalLink, Highlighter, List, Sparkles } from 'lucide-react';
import { TypographyPopover } from './TypographyPopover';
import type { ReaderPrefs } from './reader-prefs';

interface Props {
  visible: boolean;
  backHref: string;
  title: string;
  chapterLabel: string | null;
  sourceUrl: string | null;
  percent: number;
  activeDrawer: 'toc' | 'highlights' | 'chat' | null;
  onToggleDrawer: (d: 'toc' | 'highlights' | 'chat') => void;
  typographyOpen: boolean;
  onToggleTypography: () => void;
  onCloseTypography: () => void;
  prefs: ReaderPrefs;
  onPrefsChange: (patch: Partial<ReaderPrefs>) => void;
  pdfMode: { view: 'original' | 'text'; onChange: (view: 'original' | 'text') => void } | null;
}

/** Auto-hiding top bar: back, title, chapter position, tool buttons, progress. */
export function ReaderChrome({
  visible,
  backHref,
  title,
  chapterLabel,
  sourceUrl,
  percent,
  activeDrawer,
  onToggleDrawer,
  typographyOpen,
  onToggleTypography,
  onCloseTypography,
  prefs,
  onPrefsChange,
  pdfMode,
}: Props) {
  return (
    <header
      className={`reader-chrome absolute inset-x-0 top-0 z-20 transition-transform duration-300 ease-snap ${
        visible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
        <Link
          href={backHref}
          aria-label="返回详情页"
          className="r-muted grid h-8 w-8 shrink-0 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-medium">{title}</p>
          {chapterLabel && <p className="r-muted truncate text-[11px] leading-tight">{chapterLabel}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {pdfMode && (
            <div className="rborder mr-1.5 flex overflow-hidden rounded-lg border text-xs" role="tablist" aria-label="阅读模式">
              <button
                type="button"
                role="tab"
                aria-selected={pdfMode.view === 'original'}
                onClick={() => pdfMode.onChange('original')}
                className={`px-2.5 py-1 transition ${
                  pdfMode.view === 'original'
                    ? 'bg-accent-500 font-medium text-white'
                    : 'r-muted hover:bg-[var(--reader-hover)]'
                }`}
              >
                原文
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pdfMode.view === 'text'}
                onClick={() => pdfMode.onChange('text')}
                className={`px-2.5 py-1 transition ${
                  pdfMode.view === 'text'
                    ? 'bg-accent-500 font-medium text-white'
                    : 'r-muted hover:bg-[var(--reader-hover)]'
                }`}
              >
                文本
              </button>
            </div>
          )}

          <ChromeButton label="目录" active={activeDrawer === 'toc'} onClick={() => onToggleDrawer('toc')}>
            <List className="h-4 w-4" />
          </ChromeButton>
          <ChromeButton
            label="高亮与笔记"
            active={activeDrawer === 'highlights'}
            onClick={() => onToggleDrawer('highlights')}
          >
            <Highlighter className="h-4 w-4" />
          </ChromeButton>
          <div className="relative">
            <button
              type="button"
              data-typo-anchor
              aria-label="排版设置"
              onClick={onToggleTypography}
              className={`grid h-8 w-8 place-items-center rounded-lg text-sm font-semibold transition ${
                typographyOpen
                  ? 'bg-accent-500/15 text-[var(--reader-accent)]'
                  : 'r-muted hover:bg-[var(--reader-hover)]'
              }`}
            >
              Aa
            </button>
            <TypographyPopover
              open={typographyOpen}
              onClose={onCloseTypography}
              prefs={prefs}
              onChange={onPrefsChange}
            />
          </div>
          <ChromeButton label="问问 AI" active={activeDrawer === 'chat'} onClick={() => onToggleDrawer('chat')}>
            <Sparkles className="h-4 w-4" />
          </ChromeButton>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label="查看原文链接"
              className="r-muted hidden h-8 w-8 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)] sm:grid"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 h-0.5">
        <div
          className="h-full bg-accent-500 transition-[width] duration-200"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </header>
  );
}

function ChromeButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg transition ${
        active
          ? 'bg-accent-500/15 text-[var(--reader-accent)]'
          : 'r-muted hover:bg-[var(--reader-hover)]'
      }`}
    >
      {children}
    </button>
  );
}
