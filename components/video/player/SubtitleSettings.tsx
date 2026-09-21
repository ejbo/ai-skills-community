'use client';

// 字幕设置面板 — language + the viewer's own style (字号 / 位置 / 背景 / 颜色 /
// 描边 / 加粗). Presentational: the player owns the preferences
// (useSubtitlePrefs) and decides WHERE this renders — an in-frame popover above
// the control bar, or a bottom sheet when the frame is too short to hold it
// (a phone in portrait). It sits on video, so it is dark whatever the site theme
// is; `dark:` variants would be wrong here half the time.
//
// Chrome is ink-on-dark (white = selected). The four swatches are the one place
// colour appears, because they ARE the material being chosen.

import { useId, type CSSProperties, type ReactNode } from 'react';
import { RotateCcw, X } from 'lucide-react';
import {
  SUBTITLE_COLORS,
  SUBTITLE_COLOR_HEX,
  SUBTITLE_POSITION_PRESETS,
  SUBTITLE_SCALE_MAX,
  SUBTITLE_SCALE_MIN,
  SUBTITLE_SCALE_STEP,
  isDefaultSubtitleStyle,
  matchingPositionPreset,
  type SubtitleMode,
  type SubtitlePositionPreset,
  type SubtitleStyle,
} from '@/lib/video/subtitle-style';

export interface SubtitleSettingsLabels {
  title: string;
  close: string;
  language: string;
  off: string;
  zh: string;
  en: string;
  both: string;
  size: string;
  sizeSmaller: string;
  sizeLarger: string;
  position: string;
  posBottom: string;
  posMiddle: string;
  posTop: string;
  dragHint: string;
  background: string;
  backgroundNone: string;
  color: string;
  colorNames: Record<(typeof SUBTITLE_COLORS)[number], string>;
  outline: string;
  bold: string;
  reset: string;
  processing: string;
  unavailable: string;
}

interface Props {
  labels: SubtitleSettingsLabels;
  /** The RESOLVED mode (what is actually showing). */
  mode: SubtitleMode;
  has: { zh: boolean; en: boolean };
  /** A subtitle job is running for this video. */
  processing: boolean;
  style: SubtitleStyle;
  onMode: (mode: SubtitleMode) => void;
  onStyle: (patch: Partial<SubtitleStyle>) => void;
  onReset: () => void;
  onClose: () => void;
  /** 'sheet' = the bottom-sheet presentation (rounded top, safe-area padding). */
  variant: 'popover' | 'sheet';
}

const seg = (active: boolean, disabled = false) =>
  `h-8 flex-1 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
    disabled
      ? 'cursor-not-allowed text-white/25'
      : active
        ? 'bg-white text-zinc-900'
        : 'text-white/75 hover:bg-white/10 hover:text-white'
  }`;

export function SubtitleSettings({ labels: L, mode, has, processing, style, onMode, onStyle, onReset, onClose, variant }: Props) {
  const id = useId();
  const anyTrack = has.zh || has.en;
  const preset = matchingPositionPreset(style);
  const pct = Math.round(style.scale * 100);
  const bgPct = Math.round(style.bgOpacity * 100);

  const modes: { key: SubtitleMode; label: string; enabled: boolean }[] = [
    { key: 'off', label: L.off, enabled: true },
    { key: 'zh', label: L.zh, enabled: has.zh },
    { key: 'en', label: L.en, enabled: has.en },
    { key: 'both', label: L.both, enabled: has.zh && has.en },
  ];
  const presets: { key: SubtitlePositionPreset; label: string }[] = [
    { key: 'top', label: L.posTop },
    { key: 'middle', label: L.posMiddle },
    { key: 'bottom', label: L.posBottom },
  ];

  return (
    <div
      role="dialog"
      aria-label={L.title}
      data-player-panel
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={`flex flex-col overflow-hidden border border-white/10 text-white shadow-2xl ${
        // The sheet lies over the PAGE (opaque, or the page's text ghosts through it); the popover lies over video.
        variant === 'sheet' ? 'max-h-[62dvh] w-full rounded-t-2xl bg-zinc-950 pb-[env(safe-area-inset-bottom)]' : 'max-h-full w-[19rem] rounded-xl bg-zinc-950/95'
      }`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-white/10 px-3.5 py-2.5">
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{L.title}</h3>
        {!isDefaultSubtitleStyle(style) && (
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {L.reset}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={L.close}
          className="grid h-7 w-7 place-items-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3.5 py-2.5 [scrollbar-color:rgba(255,255,255,.3)_transparent] [scrollbar-width:thin]">
        <Row label={L.language}>
          <div className="flex gap-1 rounded-lg bg-white/[0.07] p-0.5" role="group" aria-label={L.language}>
            {modes.map((m) => (
              <button
                key={m.key}
                type="button"
                disabled={!m.enabled}
                aria-pressed={mode === m.key}
                onClick={() => onMode(m.key)}
                className={seg(mode === m.key, !m.enabled)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {!anyTrack && <p className="mt-1.5 text-[11px] leading-relaxed text-white/50">{processing ? L.processing : L.unavailable}</p>}
        </Row>

        <Row label={L.size} value={`${pct}%`} htmlFor={`${id}-size`}>
          <div className="flex items-center gap-2">
            <StepButton label={L.sizeSmaller} onClick={() => onStyle({ scale: style.scale - SUBTITLE_SCALE_STEP })} disabled={style.scale <= SUBTITLE_SCALE_MIN}>
              <span className="text-[11px] font-semibold">A</span>
            </StepButton>
            <input
              id={`${id}-size`}
              type="range"
              min={SUBTITLE_SCALE_MIN}
              max={SUBTITLE_SCALE_MAX}
              step={SUBTITLE_SCALE_STEP}
              value={style.scale}
              onChange={(e) => onStyle({ scale: Number(e.target.value) })}
              className="player-range min-w-0 flex-1"
              style={{ '--fill': `${((style.scale - SUBTITLE_SCALE_MIN) / (SUBTITLE_SCALE_MAX - SUBTITLE_SCALE_MIN)) * 100}%` } as CSSProperties}
            />
            <StepButton label={L.sizeLarger} onClick={() => onStyle({ scale: style.scale + SUBTITLE_SCALE_STEP })} disabled={style.scale >= SUBTITLE_SCALE_MAX}>
              <span className="text-[15px] font-semibold">A</span>
            </StepButton>
          </div>
        </Row>

        <Row label={L.position}>
          <div className="flex gap-1 rounded-lg bg-white/[0.07] p-0.5" role="group" aria-label={L.position}>
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={preset === p.key}
                onClick={() => onStyle({ ...SUBTITLE_POSITION_PRESETS[p.key] })}
                className={seg(preset === p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/50">{L.dragHint}</p>
        </Row>

        {/* Side by side: the popover has to fit a 16:9 frame ~470 px tall without scrolling. */}
        <div className="grid grid-cols-2 gap-x-4">
          <Row label={L.background} value={bgPct === 0 ? L.backgroundNone : `${bgPct}%`} htmlFor={`${id}-bg`}>
            <input
              id={`${id}-bg`}
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={style.bgOpacity}
              onChange={(e) => onStyle({ bgOpacity: Number(e.target.value) })}
              className="player-range mt-1 w-full"
              style={{ '--fill': `${bgPct}%` } as CSSProperties}
            />
          </Row>
          <Row label={L.color}>
            <div className="flex items-center gap-2" role="radiogroup" aria-label={L.color}>
              {SUBTITLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={style.color === c}
                  aria-label={L.colorNames[c]}
                  title={L.colorNames[c]}
                  onClick={() => onStyle({ color: c })}
                  className={`h-6 w-6 rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                    style.color === c ? 'border-white ring-2 ring-white ring-offset-2 ring-offset-zinc-950' : 'border-white/25 hover:border-white/60'
                  }`}
                  style={{ backgroundColor: SUBTITLE_COLOR_HEX[c] }}
                />
              ))}
            </div>
          </Row>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Toggle label={L.outline} checked={style.outline} onChange={(v) => onStyle({ outline: v })} />
          <Toggle label={L.bold} checked={style.bold} onChange={(v) => onStyle({ bold: v })} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, htmlFor, children }: { label: string; value?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[11px] font-medium uppercase tracking-wide text-white/55">
          {label}
        </label>
        {value !== undefined && <span className="font-mono text-[11px] tabular-nums text-white/70">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function StepButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex h-9 items-center justify-between gap-2 rounded-lg bg-white/[0.07] px-2.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <span className="truncate">{label}</span>
      <span className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? 'bg-white' : 'bg-white/25'}`} aria-hidden>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full transition-all ${checked ? 'left-3.5 bg-zinc-900' : 'left-0.5 bg-white'}`} />
      </span>
    </button>
  );
}
