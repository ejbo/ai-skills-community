'use client';

// 技术专区 — 主题色 picker (版块设置 → 基本信息, and the create wizard). Twelve
// swatches = the identity palette (the same hues avatars hash to, so a theme
// never introduces a 13th colour), plus a native colour input for a lab that
// has its own brand hue, plus 恢复默认 (null ⇒ the name-hashed hue). The
// preview monogram on the left shows exactly what the header / cards / wall
// will paint.

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Pipette, RotateCcw } from 'lucide-react';
import { normalizeThemeColor } from '@/lib/zones/shared';
import { BTN_GHOST, LABEL_CLS, HINT_CLS } from './ui';
import { ZONE_THEME_SWATCHES, zoneHue } from './zone-color';

export function ThemeColorPicker({
  value,
  name,
  iconUrl,
  onChange,
  disabled = false,
}: {
  /** `#rrggbb` or null (default hue). */
  value: string | null;
  /** The zone name — drives the default hue and the preview monogram. */
  name: string;
  iconUrl?: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const id = useId();
  const effective = zoneHue(name || 'Z', value);
  const custom = value !== null && !ZONE_THEME_SWATCHES.includes(value);

  return (
    <div>
      <label className={LABEL_CLS} htmlFor={`${id}-custom`}>
        {t('theme_color')}
      </label>
      <div className="flex flex-wrap items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl font-mono text-xl font-semibold uppercase text-white shadow-sm transition-colors duration-200"
          style={{ backgroundColor: effective, boxShadow: `0 0 0 2px white, 0 0 0 4px ${effective}` }}
          aria-hidden
        >
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- stored root-relative media URL
            <img src={iconUrl} alt="" className="h-full w-full rounded-2xl object-cover" />
          ) : (
            (name.trim().charAt(0) || 'Z')
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div role="radiogroup" aria-label={t('theme_color')} className="flex flex-wrap items-center gap-2">
            {ZONE_THEME_SWATCHES.map((hex) => {
              const on = value === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={hex}
                  disabled={disabled}
                  onClick={() => onChange(hex)}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-white outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-zinc-100 dark:focus-visible:ring-offset-zinc-950"
                  style={{ backgroundColor: hex, boxShadow: on ? `0 0 0 2px white, 0 0 0 4px ${hex}` : undefined }}
                >
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </button>
              );
            })}
            <label
              className={`relative flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition ${
                custom
                  ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100'
                  : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100'
              }`}
            >
              <Pipette className="h-3.5 w-3.5" />
              {t('theme_color_custom')}
              {custom && <span className="font-mono">{value}</span>}
              <input
                id={`${id}-custom`}
                type="color"
                disabled={disabled}
                value={value ?? effective}
                onChange={(e) => {
                  const next = normalizeThemeColor(e.target.value);
                  if (next) onChange(next);
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              />
            </label>
            {value !== null && (
              <button type="button" onClick={() => onChange(null)} disabled={disabled} className={`${BTN_GHOST} h-7 px-2 text-xs`}>
                <RotateCcw className="h-3.5 w-3.5" />
                {t('theme_color_reset')}
              </button>
            )}
          </div>
          <p className={HINT_CLS}>{t('theme_color_hint')}</p>
        </div>
      </div>
    </div>
  );
}
