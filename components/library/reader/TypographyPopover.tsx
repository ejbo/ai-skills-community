'use client';

import { useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type ReaderLineHeight,
  type ReaderPrefs,
  type ReaderTheme,
  type ReaderWidth,
} from './reader-prefs';

const LINE_HEIGHTS: { value: ReaderLineHeight; label: string }[] = [
  { value: 1.5, label: '紧凑' },
  { value: 1.75, label: '适中' },
  { value: 2, label: '宽松' },
];

const WIDTHS: { value: ReaderWidth; label: string }[] = [
  { value: 'narrow', label: '窄' },
  { value: 'normal', label: '适中' },
  { value: 'wide', label: '宽' },
];

const THEMES: { value: ReaderTheme; label: string; swatch: string }[] = [
  { value: 'auto', label: '跟随', swatch: 'linear-gradient(135deg, #ffffff 50%, #18181b 50%)' },
  { value: 'light', label: '浅色', swatch: '#fafafb' },
  { value: 'sepia', label: '护眼', swatch: '#faf4e8' },
  { value: 'dark', label: '深色', swatch: '#18181b' },
];

/** Aa popover anchored under the chrome button (button carries data-typo-anchor). */
export function TypographyPopover({
  open,
  onClose,
  prefs,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (ref.current?.contains(t) || t.closest('[data-typo-anchor]')) return;
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
      aria-label="排版设置"
      className="reader-panel rborder absolute right-0 top-11 z-50 w-64 space-y-4 rounded-xl border p-4 shadow-xl"
    >
      <section className="space-y-1.5">
        <Label>字号</Label>
        <div className="flex items-center gap-2">
          <StepButton
            label="减小字号"
            disabled={prefs.fontSize <= MIN_FONT_SIZE}
            onClick={() => onChange({ fontSize: prefs.fontSize - 1 })}
          >
            <Minus className="h-3.5 w-3.5" />
          </StepButton>
          <span className="flex-1 text-center font-mono text-sm tabular-nums">{prefs.fontSize}px</span>
          <StepButton
            label="增大字号"
            disabled={prefs.fontSize >= MAX_FONT_SIZE}
            onClick={() => onChange({ fontSize: prefs.fontSize + 1 })}
          >
            <Plus className="h-3.5 w-3.5" />
          </StepButton>
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>字体</Label>
        <div className="grid grid-cols-2 gap-1.5">
          <Segment active={!prefs.serif} onClick={() => onChange({ serif: false })}>
            黑体
          </Segment>
          <Segment active={prefs.serif} onClick={() => onChange({ serif: true })}>
            <span style={{ fontFamily: "'Songti SC', Georgia, serif" }}>宋体</span>
          </Segment>
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>行距</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {LINE_HEIGHTS.map((o) => (
            <Segment
              key={o.value}
              active={prefs.lineHeight === o.value}
              onClick={() => onChange({ lineHeight: o.value })}
            >
              {o.label}
            </Segment>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>版宽</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {WIDTHS.map((o) => (
            <Segment key={o.value} active={prefs.width === o.value} onClick={() => onChange({ width: o.value })}>
              {o.label}
            </Segment>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <Label>主题</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {THEMES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => onChange({ theme: t.value })}
              aria-pressed={prefs.theme === t.value}
              className="flex flex-col items-center gap-1"
            >
              <span
                className={`h-6 w-6 rounded-full border ${
                  prefs.theme === t.value
                    ? 'border-accent-500 ring-2 ring-accent-500/40'
                    : 'border-[var(--reader-border)]'
                }`}
                style={{ background: t.swatch }}
              />
              <span className={`text-[11px] ${prefs.theme === t.value ? 'font-medium text-[var(--reader-accent)]' : 'r-muted'}`}>
                {t.label}
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
