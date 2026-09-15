'use client';

// 名片配色. The card is the member's own material, so this is one of the few
// places a hue is chosen at all (配色契约: content keeps its colour). Options:
//   默认 — null, the name-hashed identity colour (the one their avatar already wears)
//   12 swatches — the identity palette itself, so a card never introduces a 13th hue
//   自定义 — a native colour input, normalised through normalizeHexColor
// The strip under the row paints `cardPalette(effective)` — the exact gradient a
// card with no media is filled with, so the choice is judged on the real thing.

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Pipette, RotateCcw } from 'lucide-react';
import { IDENTITY_COLORS } from '@/lib/identity-color';
import { cardPalette, normalizeHexColor } from '@/lib/profile/shared';
import { BTN_GHOST, HINT_CLS } from '../_components/ui';

const SWATCHES = IDENTITY_COLORS.map((c) => c.toLowerCase());

function ring(hex: string) {
  return `0 0 0 2px rgb(var(--surface)), 0 0 0 4px ${hex}`;
}

export function ThemeSwatches({
  value,
  identity,
  onChange,
}: {
  /** Stored `#rrggbb`, or null for the identity colour. */
  value: string | null;
  /** The member's identity colour (what null resolves to). */
  identity: string;
  onChange: (next: string | null) => void;
}) {
  const t = useTranslations('settings');
  const id = useId();
  const current = value ? value.toLowerCase() : null;
  const effective = current ?? identity.toLowerCase();
  const custom = current !== null && !SWATCHES.includes(current);
  const palette = cardPalette(effective);

  return (
    <div>
      <div role="radiogroup" aria-label={t('ce_theme_title')} className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          role="radio"
          aria-checked={current === null}
          onClick={() => onChange(null)}
          className={`inline-flex h-8 items-center gap-2 rounded-full border pl-1 pr-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-100/30 ${
            current === null
              ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
              : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-white" style={{ backgroundColor: identity }}>
            {current === null && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
          </span>
          {t('ce_theme_default')}
        </button>

        <span aria-hidden className="mx-0.5 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />

        {SWATCHES.map((hex) => {
          const on = current === hex;
          return (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={hex}
              title={hex}
              onClick={() => onChange(hex)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white outline-none transition-transform duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:scale-100 dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950"
              style={{ backgroundColor: hex, boxShadow: on ? ring(hex) : undefined }}
            >
              {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </button>
          );
        })}

        <label
          htmlFor={`${id}-custom`}
          className={`relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-within:ring-2 focus-within:ring-zinc-900/30 dark:focus-within:ring-zinc-100/30 ${
            custom
              ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
              : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
          }`}
        >
          {custom ? (
            <span className="h-4 w-4 rounded-full" style={{ backgroundColor: effective }} aria-hidden />
          ) : (
            <Pipette className="h-3.5 w-3.5" aria-hidden />
          )}
          {t('ce_theme_custom')}
          {custom && <span className="font-mono text-[11px] uppercase">{effective}</span>}
          <input
            id={`${id}-custom`}
            type="color"
            value={effective}
            onChange={(e) => {
              const next = normalizeHexColor(e.target.value);
              if (next) onChange(next);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>

        {current !== null && (
          <button type="button" onClick={() => onChange(null)} className={`${BTN_GHOST} h-8 px-2 text-xs`}>
            <RotateCcw className="h-3.5 w-3.5" />
            {t('ce_theme_reset')}
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div
          aria-hidden
          className="h-9 flex-1 rounded-lg ring-1 ring-inset ring-black/5 dark:ring-white/10"
          style={{ backgroundImage: `${palette.innerGradient}, ${palette.emptyGradient}` }}
        />
        <span className="font-mono text-[11px] uppercase tabular-nums text-zinc-500">{effective}</span>
      </div>
      <p className={HINT_CLS}>{t('ce_theme_hint')}</p>
    </div>
  );
}
