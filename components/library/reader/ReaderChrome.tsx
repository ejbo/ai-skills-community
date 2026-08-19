'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft, ExternalLink, List, PanelRight } from 'lucide-react';
import { TypographyPopover } from './TypographyPopover';
import type { ReaderPrefs } from './reader-prefs';

interface Props {
  /** Collapses upward on scroll-down; the progress bar lives OUTSIDE (shell). */
  visible: boolean;
  onBack: () => void;
  title: string;
  chapterLabel: string | null;
  sourceUrl: string | null;
  tocOpen: boolean;
  /** ONE toggle for the whole right panel — its tabs (助手/笔记/评论/相似) live inside. */
  panelOpen: boolean;
  onToggleToc: () => void;
  onTogglePanel: () => void;
  typographyOpen: boolean;
  onToggleTypography: () => void;
  onCloseTypography: () => void;
  prefs: ReaderPrefs;
  onPrefsChange: (patch: Partial<ReaderPrefs>) => void;
  flow: { mode: 'paged' | 'flow'; available: boolean; onChange: (mode: 'paged' | 'flow') => void } | null;
  pdfMode: {
    view: 'original' | 'text';
    canAnnotate: boolean;
    onChange: (view: 'original' | 'text') => void;
  } | null;
}

/** Auto-hiding top bar: back, viewport-centered title, panel toggles. */
export function ReaderChrome({
  visible,
  onBack,
  title,
  chapterLabel,
  sourceUrl,
  tocOpen,
  panelOpen,
  onToggleToc,
  onTogglePanel,
  typographyOpen,
  onToggleTypography,
  onCloseTypography,
  prefs,
  onPrefsChange,
  flow,
  pdfMode,
}: Props) {
  const t = useTranslations('reader');
  const td = useTranslations('detail');
  return (
    <header
      className={`reader-chrome relative z-30 shrink-0 overflow-visible transition-[max-height,opacity] duration-300 ease-snap ${
        visible ? 'max-h-12 opacity-100' : 'pointer-events-none max-h-0 opacity-0'
      }`}
    >
      {/* Title centered on the VIEWPORT (not between the asymmetric button
          clusters) — absolutely positioned, width-clamped so it can't overlap
          the toolbars; small screens fall back to inline centering. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-12 flex-col items-center justify-center px-4 md:flex">
        <p className="max-w-[min(680px,calc(100%-620px))] truncate text-sm font-medium">{title}</p>
        {chapterLabel && (
          <p className="r-muted max-w-[min(680px,calc(100%-620px))] truncate text-[11px] leading-tight">
            {chapterLabel}
          </p>
        )}
      </div>
      <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
        <button
          type="button"
          onClick={onBack}
          aria-label={td('back')}
          className="r-muted grid h-8 w-8 shrink-0 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)]"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1 text-center md:invisible">
          <p className="truncate text-sm font-medium">{title}</p>
          {chapterLabel && <p className="r-muted truncate text-[11px] leading-tight">{chapterLabel}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {pdfMode && pdfMode.canAnnotate && (
            <div
              className="rborder mr-1.5 flex overflow-hidden rounded-lg border text-xs"
              role="tablist"
              aria-label={t('pdf_view_mode')}
            >
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
                {t('pdf_original')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={pdfMode.view === 'text'}
                onClick={() => pdfMode.onChange('text')}
                title={t('pdf_annotate_hint')}
                className={`px-2.5 py-1 transition ${
                  pdfMode.view === 'text'
                    ? 'bg-accent-500 font-medium text-white'
                    : 'r-muted hover:bg-[var(--reader-hover)]'
                }`}
              >
                {t('pdf_reader')}
              </button>
            </div>
          )}

          <ChromeButton label={t('toc')} active={tocOpen} onClick={onToggleToc}>
            <List className="h-4 w-4" />
          </ChromeButton>
          <div className="relative">
            <button
              type="button"
              data-typo-anchor
              aria-label={t('typography_settings')}
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
              flow={flow}
            />
          </div>
          <ChromeButton label={t('side_panel')} active={panelOpen} onClick={onTogglePanel}>
            <PanelRight className="h-4 w-4" />
          </ChromeButton>
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer nofollow"
              aria-label={t('view_source_link')}
              className="r-muted hidden h-8 w-8 place-items-center rounded-lg transition hover:bg-[var(--reader-hover)] sm:grid"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
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
