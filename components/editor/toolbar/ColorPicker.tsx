'use client';

// 文字颜色 / 背景色 — two SPLIT buttons sharing one palette (Word / 飞书):
//   • the glyph half (A with a bar / a highlighter with a bar) applies the
//     LAST-USED colour of that kind straight away — the bar shows which;
//   • the caret half opens the palette: 自动 (text) / 无填充 (background), the
//     10 × 6 theme grid, the 10 standard colours, 最近使用 and 自定义 (native
//     colour input + a hex field + 应用).
//
// Everything stored is lowercase `#rrggbb` (lib/rich-marks.ts). A legacy NAMED
// value on the selection (v2 bodies: `data-color="red"`) marks its palette
// swatch as current through LEGACY_COLOR_SWATCH (palette.ts).
//
// Keyboard: the swatches are one 2-D grid across 主题 / 标准 / 最近 with a
// roving tab stop — arrows move, Home / End jump within a row, Enter / Space
// apply; Tab reaches 自动, the grid, then the custom inputs. Esc closes and
// returns to the editor. A pick always closes the panel.
//
// WHAT A SWATCH SHOWS is the colour AS THE PAGE WILL PAINT IT, not the raw hex:
// every swatch carries `.rte-swatch` + `--rt-c` / `--rt-bg` and is listed in the
// very same app/rich-text.css rules that paint `span[data-color]` /
// `span[data-bg]`, so the dark-ground clamp applies to the preview too. Pure
// #ffff00 in the palette next to an olive highlight in the text was the one
// thing an author could not predict.
//
// TOUCH: on a coarse pointer the swatches and the split button's caret half grow
// to ≥24 px (20 px squares 4 px apart are a mis-tap), which also widens the
// panel — the anchoring maths needs that number, hence the media query in JS.

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { Editor } from '@tiptap/core';
import { Baseline, Check, ChevronDown, Highlighter } from 'lucide-react';
import { normalizeHexColor } from '@/lib/rich-marks';
import {
  PALETTE_COLUMNS,
  STANDARD_COLORS,
  THEME_GRID,
  inkOn,
  readLastColor,
  readRecentColors,
  rememberColor,
  swatchValueFor,
  type ColorKind,
  type Swatch,
} from '@/components/editor/toolbar/palette';
import {
  ToolbarPanelShell,
  keepEditorSelection,
  toolbarClasses,
  useShortcutTitle,
  useToolbarPanel,
  useToolbarTone,
  type ToolbarPanel,
} from '@/components/editor/toolbar/primitives';

/** Swatch edge and panel width per pointer kind: 10 columns + 9 gaps + the panel's padding. */
const SWATCH = { fine: 20, coarse: 28 } as const;
const GAP = 4;
const PANEL_PAD = 24;
const panelWidth = (swatch: number) => PALETTE_COLUMNS * swatch + (PALETTE_COLUMNS - 1) * GAP + PANEL_PAD;
const PANEL_H = 392;

/**
 * Client-only (the toolbar never renders on the server), so no hydration
 * mismatch — and never fatal: an environment without `matchMedia` (jsdom, where
 * every comment box in the app is also mounted) simply stays fine-pointer.
 */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const read = () => setCoarse(mq.matches);
    read();
    mq.addEventListener?.('change', read);
    return () => mq.removeEventListener?.('change', read);
  }, []);
  return coarse;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** 「红色，浅色 80% (#f8c3c2)」 / 「颜色 #1f6feb」 */
function swatchLabel(t: Translate, swatch: Pick<Swatch, 'hex' | 'nameKey' | 'shade'> | { hex: string; nameKey?: undefined; shade?: undefined }): string {
  if (!swatch.nameKey) return t('rte_swatch_hex', { hex: swatch.hex });
  const base = t(swatch.nameKey);
  const name = swatch.shade
    ? t(swatch.shade.dir === 'lighter' ? 'rte_swatch_lighter' : 'rte_swatch_darker', { name: base, percent: swatch.shade.percent })
    : base;
  return t('rte_swatch', { name, hex: swatch.hex });
}

function applyColor(editor: Editor, kind: ColorKind, value: string | null): boolean {
  const chain = editor.chain().focus();
  if (kind === 'color') return (value == null ? chain.unsetTextColor() : chain.setTextColor(value)).run();
  return (value == null ? chain.unsetTextBg() : chain.setTextBg(value)).run();
}

export function ColorSplitButton({
  editor,
  kind,
  value,
  mixed = false,
  disabled,
}: {
  editor: Editor;
  kind: ColorKind;
  /** The stored value at the selection (hex or a legacy name), null when mixed / none. */
  value: string | null;
  /** The selection mixes colours (or coloured and plain text). */
  mixed?: boolean;
  disabled: boolean;
}) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  const coarse = useCoarsePointer();
  const swatchPx = coarse ? SWATCH.coarse : SWATCH.fine;
  const width = panelWidth(swatchPx);
  const panel = useToolbarPanel<HTMLSpanElement>({ editor, tone, width, height: PANEL_H, disabled });

  // Client-only component (the toolbar never renders on the server): reading
  // localStorage in the initialiser cannot disagree with a server render.
  const [last, setLast] = useState<`#${string}`>(() => readLastColor(kind));
  const [recent, setRecent] = useState<`#${string}`[]>(() => readRecentColors(kind));

  const pick = (next: string | null) => {
    panel.close(false);
    const ok = applyColor(editor, kind, next);
    const hex = next == null ? null : normalizeHexColor(next);
    if (ok && hex) {
      setRecent(rememberColor(kind, hex));
      setLast(hex);
    }
  };

  const openPalette = (e: React.MouseEvent) => {
    if (!panel.open) {
      // Another editor on the page may have changed them since this one mounted.
      setRecent(readRecentColors(kind));
      setLast(readLastColor(kind));
    }
    panel.toggleFrom(e);
  };

  const applyLabel = t(kind === 'color' ? 'rte_text_color_apply' : 'rte_bg_color_apply', { color: last });
  const moreLabel = t(kind === 'color' ? 'rte_text_color_more' : 'rte_bg_color_more');
  const glyphTitle = useShortcutTitle(applyLabel);
  const Icon = kind === 'color' ? Baseline : Highlighter;
  const half = `flex h-7 items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${cls.focus}`;

  return (
    <span ref={panel.triggerRef} className="rte-color-split inline-flex items-center rounded-md" data-kind={kind}>
      <button
        type="button"
        title={glyphTitle.tooltip}
        aria-label={applyLabel}
        data-rte-control={kind === 'color' ? 'text-color' : 'bg-color'}
        disabled={disabled}
        onMouseDown={keepEditorSelection}
        onClick={() => pick(last)}
        className={`${half} relative w-7 rounded-l-md ${panel.open ? cls.on : cls.idle}`}
      >
        <Icon className={kind === 'color' ? 'h-4 w-4' : 'h-[15px] w-[15px] -translate-y-[1.5px]'} aria-hidden />
        {/* The colour this half applies — a ring keeps white / pale colours visible. */}
        <span
          aria-hidden
          data-last-color={last}
          data-kind={kind}
          className="rte-swatch pointer-events-none absolute bottom-[4px] left-[7px] right-[7px] h-[3px] rounded-full shadow-[0_0_0_0.5px_rgb(0_0_0/0.35)]"
          style={{ [kind === 'color' ? '--rt-c' : '--rt-bg']: last } as CSSProperties}
        />
      </button>
      <button
        type="button"
        title={moreLabel}
        aria-label={moreLabel}
        aria-haspopup="dialog"
        aria-expanded={panel.open}
        data-rte-control={kind === 'color' ? 'text-color-more' : 'bg-color-more'}
        disabled={disabled}
        onMouseDown={keepEditorSelection}
        onClick={openPalette}
        // 14 px is a fine-pointer target; a finger gets 24.
        className={`${half} w-3.5 rounded-r-md [@media(pointer:coarse)]:w-6 ${panel.open ? cls.on : cls.idle}`}
      >
        <ChevronDown className="h-3 w-3 opacity-70" aria-hidden />
      </button>
      {/* Mounted per opening, so the custom field and the roving stop start fresh each time. */}
      {panel.open && (
        <ColorPalettePanel panel={panel} kind={kind} value={value} mixed={mixed} recent={recent} onPick={pick} width={width} swatchPx={swatchPx} />
      )}
    </span>
  );
}

function ColorPalettePanel({
  panel,
  kind,
  value,
  mixed,
  recent,
  onPick,
  width,
  swatchPx,
}: {
  panel: ToolbarPanel<HTMLSpanElement>;
  kind: ColorKind;
  value: string | null;
  mixed: boolean;
  recent: readonly `#${string}`[];
  onPick: (value: string | null) => void;
  width: number;
  swatchPx: number;
}) {
  const t = useTranslations('ui');
  const tone = useToolbarTone();
  const cls = toolbarClasses(tone);
  const active = swatchValueFor(value);

  // Rows of the one keyboard grid: theme 0–5, standard 6, recent 7.
  const rows = useMemo<Array<{ id: string; swatches: ReadonlyArray<Pick<Swatch, 'hex' | 'nameKey' | 'shade'> | { hex: `#${string}` }> }>>(
    () => [
      ...THEME_GRID.map((row, i) => ({ id: `theme-${i}`, swatches: row })),
      { id: 'standard', swatches: STANDARD_COLORS },
      ...(recent.length ? [{ id: 'recent', swatches: recent.map((hex) => ({ hex })) }] : []),
    ],
    [recent],
  );

  // Roving tab stop: the current colour's first swatch, else the first swatch.
  const defaultRover = useMemo(() => {
    for (let r = 0; r < rows.length; r += 1) {
      const c = rows[r].swatches.findIndex((s) => s.hex === active);
      if (c >= 0) return `${r}:${c}`;
    }
    return '0:0';
  }, [rows, active]);
  const [rover, setRover] = useState<string | null>(null);
  const tabStop = rover ?? defaultRover;

  // `#` is implied: `1f6feb` is what a design tool copies, and refusing it was
  // the field's most common failure. The STORAGE validator stays strict — this
  // is the one place that guesses, and it hands normalizeHexColor a full value.
  const [hexText, setHexText] = useState(() => active ?? '');
  const [showError, setShowError] = useState(false);
  const trimmed = hexText.trim();
  const parsed = normalizeHexColor(/^[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(trimmed) ? `#${trimmed}` : trimmed);
  // Only after blur or an attempted submit: the message used to flash on nearly
  // every keystroke of `#1f6feb` (and `role="alert"` announced each flash).
  const invalid = showError && trimmed !== '' && parsed == null;
  const editHex = (next: string) => {
    setHexText(next);
    setShowError(false);
  };

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const r = Number(target.dataset.navRow);
    const c = Number(target.dataset.navCol);
    if (!target.dataset.navRow || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const len = (row: number) => rows[row]?.swatches.length ?? 0;
    let nr = r;
    let nc = c;
    if (e.key === 'ArrowRight') {
      if (c + 1 < len(r)) nc = c + 1;
      else if (r + 1 < rows.length) [nr, nc] = [r + 1, 0];
    } else if (e.key === 'ArrowLeft') {
      if (c > 0) nc = c - 1;
      else if (r > 0) [nr, nc] = [r - 1, len(r - 1) - 1];
    } else if (e.key === 'ArrowDown') {
      if (r + 1 < rows.length) [nr, nc] = [r + 1, Math.min(c, len(r + 1) - 1)];
    } else if (e.key === 'ArrowUp') {
      if (r > 0) [nr, nc] = [r - 1, Math.min(c, len(r - 1) - 1)];
    } else if (e.key === 'Home') nc = 0;
    else if (e.key === 'End') nc = len(r) - 1;
    const next = e.currentTarget.querySelector<HTMLButtonElement>(`[data-nav-row="${nr}"][data-nav-col="${nc}"]`);
    if (next) {
      setRover(`${nr}:${nc}`);
      next.focus();
    }
  };

  const swatchButton = (swatch: Pick<Swatch, 'hex' | 'nameKey' | 'shade'> | { hex: `#${string}` }, r: number, c: number) => {
    const on = swatch.hex === active;
    const label = swatchLabel(t as Translate, swatch as Swatch);
    return (
      <button
        key={`${r}:${c}`}
        type="button"
        title={label}
        aria-label={label}
        aria-pressed={on}
        data-color={swatch.hex}
        data-nav-row={r}
        data-nav-col={c}
        tabIndex={tabStop === `${r}:${c}` ? 0 : -1}
        data-autofocus={tabStop === `${r}:${c}` ? '' : undefined}
        onFocus={() => setRover(`${r}:${c}`)}
        onMouseDown={keepEditorSelection}
        onClick={() => onPick(swatch.hex)}
        className={`rte-swatch relative flex items-center justify-center rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[rgb(var(--accent))] ${
          on ? `${cls.ring} ring-offset-1` : ''
        } ${tone === 'reader' ? 'shadow-[inset_0_0_0_1px_var(--reader-border)]' : 'shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] dark:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.16)]'}`}
        data-kind={kind}
        // The clamped paint comes from app/rich-text.css via `.rte-swatch`.
        style={{ height: swatchPx, width: swatchPx, [kind === 'color' ? '--rt-c' : '--rt-bg']: swatch.hex } as CSSProperties}
      >
        {on && <Check className="h-3 w-3" style={{ color: inkOn(swatch.hex) }} strokeWidth={3} aria-hidden />}
      </button>
    );
  };

  const section = `mb-1 mt-2.5 text-[11px] font-medium ${cls.muted}`;
  const autoLabel = t(kind === 'color' ? 'rte_color_auto' : 'rte_bg_no_fill');
  const title = t(kind === 'color' ? 'rte_text_color' : 'rte_bg_color');
  const gridStyle = { gridTemplateColumns: `repeat(${PALETTE_COLUMNS}, ${swatchPx}px)` };

  return (
    <ToolbarPanelShell panel={panel} label={title} width={width} className="p-3">
      <button
        type="button"
        aria-pressed={value == null && !mixed}
        data-rte-palette="auto"
        onMouseDown={keepEditorSelection}
        onClick={() => onPick(null)}
        className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] ${cls.hover} ${cls.focus} ${value == null && !mixed ? cls.selected : ''}`}
      >
        {kind === 'color' ? (
          <span aria-hidden className="flex h-5 w-5 items-center justify-center text-[14px] font-semibold">
            A
          </span>
        ) : (
          <span aria-hidden className={`relative flex h-5 w-5 items-center justify-center overflow-hidden rounded-[4px] border ${cls.hairline}`}>
            <span className="h-px w-[140%] -rotate-45 bg-red-500" />
          </span>
        )}
        {autoLabel}
      </button>

      <div onKeyDown={onGridKey}>
        <div className={section} id={`rte-pal-${kind}-theme`}>
          {t('rte_palette_theme')}
        </div>
        <div role="group" aria-labelledby={`rte-pal-${kind}-theme`} className="grid gap-x-1" style={gridStyle}>
          {rows.slice(0, THEME_GRID.length).map((row, r) =>
            row.swatches.map((s, c) => (
              // The base row stands apart; the five shade rows sit tight (Word).
              <div key={`${r}:${c}`} className={r === 0 ? 'mb-1.5' : 'mb-0.5'}>
                {swatchButton(s, r, c)}
              </div>
            )),
          )}
        </div>

        <div className={section} id={`rte-pal-${kind}-standard`}>
          {t('rte_palette_standard')}
        </div>
        <div role="group" aria-labelledby={`rte-pal-${kind}-standard`} className="grid gap-x-1" style={gridStyle}>
          {STANDARD_COLORS.map((s, c) => swatchButton(s, THEME_GRID.length, c))}
        </div>

        {recent.length > 0 && (
          <>
            <div className={section} id={`rte-pal-${kind}-recent`}>
              {t('rte_palette_recent')}
            </div>
            <div role="group" aria-labelledby={`rte-pal-${kind}-recent`} className="grid gap-x-1" style={gridStyle} data-recent>
              {recent.map((hex, c) => swatchButton({ hex }, THEME_GRID.length + 1, c))}
            </div>
          </>
        )}
      </div>

      <form
        className={`mt-3 border-t pt-2.5 ${cls.hairline}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) onPick(parsed);
          else setShowError(true);
        }}
      >
        <label className={`mb-1 block text-[11px] font-medium ${cls.muted}`} htmlFor={`rte-pal-${kind}-hex`}>
          {t('rte_palette_custom')}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            aria-label={t('rte_palette_custom_picker')}
            value={parsed ?? active ?? '#000000'}
            onChange={(e) => editHex(e.target.value)}
            className={`h-7 w-8 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5 ${cls.hairline}`}
          />
          <input
            id={`rte-pal-${kind}-hex`}
            type="text"
            inputMode="text"
            spellCheck={false}
            autoComplete="off"
            maxLength={9}
            placeholder="#1f6feb"
            aria-label={t('rte_palette_hex')}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `rte-pal-${kind}-err` : undefined}
            value={hexText}
            onChange={(e) => editHex(e.target.value)}
            onBlur={() => setShowError(true)}
            className={`h-7 min-w-0 flex-1 rounded-md border px-2 font-mono text-[12px] ${cls.field} ${cls.focus} ${invalid ? 'border-red-500' : ''}`}
          />
          <button
            type="submit"
            // Enabled even for an unparseable value: a disabled default button
            // swallows the form's implicit submission, so Enter on garbage would
            // neither apply nor explain itself.
            disabled={trimmed === ''}
            className={`h-7 shrink-0 rounded-md px-2.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${cls.primary} ${cls.focus}`}
          >
            {t('rte_palette_apply')}
          </button>
        </div>
        {invalid && (
          <p id={`rte-pal-${kind}-err`} role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
            {t('rte_palette_hex_invalid')}
          </p>
        )}
      </form>
    </ToolbarPanelShell>
  );
}
