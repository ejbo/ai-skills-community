'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type ReaderLineHeight,
  type ReaderPrefs,
  type ReaderTheme,
  type ReaderWidth,
} from './reader-prefs';

// labelKey → reader.* message keys, translated at render time.
const LINE_HEIGHTS: { value: ReaderLineHeight; labelKey: string }[] = [
  { value: 1.5, labelKey: 'lh_compact' },
  { value: 1.75, labelKey: 'lh_normal' },
  { value: 2, labelKey: 'lh_loose' },
];

const WIDTHS: { value: ReaderWidth; labelKey: string }[] = [
  { value: 'narrow', labelKey: 'width_narrow' },
  { value: 'normal', labelKey: 'width_normal' },
  { value: 'wide', labelKey: 'width_wide' },
];

const THEMES: { value: ReaderTheme; labelKey: string; swatch: string }[] = [
  { value: 'auto', labelKey: 'theme_auto', swatch: 'linear-gradient(135deg, #ffffff 50%, #18181b 50%)' },
  { value: 'light', labelKey: 'theme_light', swatch: '#fafafb' },
  { value: 'sepia', labelKey: 'theme_sepia', swatch: '#faf4e8' },
  { value: 'dark', labelKey: 'theme_dark', swatch: '#18181b' },
];

/** Aa popover anchored under the chrome button (button carries data-typo-anchor). */
export function TypographyPopover({
  open,
  onClose,
  prefs,
  onChange,
  flow,
}: {
  open: boolean;
  onClose: () => void;
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
  /** 连续/分章 reading mode (null = single-chapter doc, no choice to make). */
  flow: { mode: 'paged' | 'flow'; available: boolean; onChange: (mode: 'paged' | 'flow') => void } | null;
}) {
  const t = useTranslations('reader');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (ref.current?.contains(el) || el.closest('[data-typo-anchor]')) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('typography_settings')}
      className="reader-panel rborder absolute right-0 top-11 z-50 w-64 space-y-4 rounded-xl border p-4 shadow-xl"
    >
      {flow && (
        <section className="space-y-1.5">
          <Label>{t('reading_mode')}</Label>
          <div className="grid grid-cols-2 gap-1.5">
            <Segment active={flow.mode === 'flow'} onClick={() => flow.available && flow.onChange('flow')}>
              {t('flow_mode')}
            </Segment>
            <Segment active={flow.mode === 'paged'} onClick={() => flow.onChange('paged')}>
              {t('paged_mode')}
            </Segment>
          </div>
          {!flow.available && (
            <p className="r-muted text-[11px]">{t('flow_unavailable')}</p>
          )}
        </section>
      )}

      <section className="space-y-1.5">
        <Label>{t('font_size')}</Label>
        <div className="flex items-center gap-2">
          <StepButton
            label={t('decrease_font')}
            disabled={prefs.fontSize <= MIN_FONT_SIZE}
            onClick={() => onChange({ fontSize: prefs.fontSize - 1 })}
          >
            <Minus className="h-3.5 w-3.5" />
          </StepButton>
          <span className="flex-1 text-center font-mono text-sm tabular-nums">{prefs.fontSize}px</span>
          <StepButton
            label={t('increase_font')}
            disabled={prefs.fontSize >= MAX_FONT_SIZE}
            onClick={() => onChange({ fontSize: prefs.fontSize + 1 })}
          >
            <Plus className="h-3.5 w-3.5" />
          </StepButton>
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>{t('font_family')}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          <Segment active={!prefs.serif} onClick={() => onChange({ serif: false })}>
            {t('font_sans')}
          </Segment>
          <Segment active={prefs.serif} onClick={() => onChange({ serif: true })}>
            <span style={{ fontFamily: "'Songti SC', Georgia, serif" }}>{t('font_serif')}</span>
          </Segment>
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>{t('line_height')}</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {LINE_HEIGHTS.map((o) => (
            <Segment
              key={o.value}
              active={prefs.lineHeight === o.value}
              onClick={() => onChange({ lineHeight: o.value })}
            >
              {t(o.labelKey)}
            </Segment>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>{t('page_width')}</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {WIDTHS.map((o) => (
            <Segment key={o.value} active={prefs.width === o.value} onClick={() => onChange({ width: o.value })}>
              {t(o.labelKey)}
            </Segment>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>{t('theme')}</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              onClick={() => onChange({ theme: theme.value })}
              aria-pressed={prefs.theme === theme.value}
              className="flex flex-col items-center gap-1"
            >
              <span
                className={`h-6 w-6 rounded-full border ${
                  prefs.theme === theme.value
                    ? 'border-accent-500 ring-2 ring-accent-500/40'
                    : 'border-[var(--reader-border)]'
                }`}
                style={{ background: theme.swatch }}
              />
              <span className={`text-[11px] ${prefs.theme === theme.value ? 'font-medium text-[var(--reader-accent)]' : 'r-muted'}`}>
                {t(theme.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="r-muted text-[11px] font-medium uppercase tracking-wide">{children}</p>;
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rborder h-8 rounded-lg border text-sm transition ${
        active
          ? 'border-accent-500 bg-accent-500/10 font-medium text-[var(--reader-accent)]'
          : 'hover:bg-[var(--reader-hover)]'
      }`}
    >
      {children}
    </button>
  );
}

function StepButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rborder grid h-8 w-10 place-items-center rounded-lg border transition hover:bg-[var(--reader-hover)] disabled:opacity-40"
    >
      {children}
    </button>
  );
}
