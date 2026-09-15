'use client';

// 全息纹理 picker: the luminance mask the holo shine is cut through
// (CardConfig.pattern). Each option is drawn as a small tile — the card's own
// theme gradient with the pattern laid over it in white — so the member picks
// by shape, not by name. Pattern ids are per-instance (useId): two pickers, or
// a picker next to a card's own SVG defs, must never resolve each other's url(#…).

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { CARD_PATTERNS, cardPalette, type CardPattern } from '@/lib/profile/shared';

function PatternArt({ pattern, uid }: { pattern: CardPattern; uid: string }) {
  if (pattern === 'none') return null;
  const pid = `${uid}-${pattern}`;
  return (
    <svg aria-hidden className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
      <defs>
        {pattern === 'grid' && (
          <pattern id={pid} width="9" height="9" patternUnits="userSpaceOnUse">
            <path d="M9 0H0V9" fill="none" stroke="white" strokeWidth="1" />
          </pattern>
        )}
        {pattern === 'dots' && (
          <pattern id={pid} width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="1.3" fill="white" />
          </pattern>
        )}
        {pattern === 'waves' && (
          <pattern id={pid} width="16" height="8" patternUnits="userSpaceOnUse">
            <path d="M0 4 Q4 0 8 4 T16 4" fill="none" stroke="white" strokeWidth="1.2" />
          </pattern>
        )}
      </defs>
      <rect width="100%" height="100%" fill={`url(#${pid})`} opacity="0.55" />
    </svg>
  );
}

export function PatternPicker({
  value,
  theme,
  onChange,
}: {
  value: CardPattern;
  /** Resolved `#rrggbb` the tiles are painted with. */
  theme: string;
  onChange: (next: CardPattern) => void;
}) {
  const t = useTranslations('settings');
  const uid = useId().replace(/:/g, '');
  const palette = cardPalette(theme);

  return (
    <div role="radiogroup" aria-label={t('ce_pattern')} className="grid grid-cols-4 gap-2 sm:max-w-sm">
      {CARD_PATTERNS.map((p) => {
        const on = value === p;
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p)}
            className="group flex flex-col items-center gap-1.5 rounded-xl p-1 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/30 dark:focus-visible:ring-zinc-100/30"
          >
            <span
              className={`relative block aspect-square w-full overflow-hidden rounded-lg bg-zinc-950 transition ${
                on
                  ? 'ring-2 ring-zinc-900 ring-offset-2 ring-offset-[rgb(var(--surface))] dark:ring-zinc-100'
                  : 'ring-1 ring-black/10 group-hover:ring-zinc-400 dark:ring-white/10'
              }`}
              style={{ backgroundImage: palette.innerGradient }}
            >
              <PatternArt pattern={p} uid={uid} />
            </span>
            <span className={`w-full truncate text-center ${on ? 'text-zinc-900 dark:text-zinc-100' : 'text-muted'}`}>{t(`ce_pattern_${p}`)}</span>
          </button>
        );
      })}
    </div>
  );
}
