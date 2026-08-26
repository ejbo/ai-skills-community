'use client';

// 帖子可见范围 (ask #4) — 公开可见 (`zone`) / 仅成员可见 (`members`) /
// 指定成员可见 (`restricted`). Post visibility NARROWS within the zone; it can
// never widen it (a `zone` post inside a 仅成员 版块 is still members-only), so
// the descriptions talk about "everyone who can open this zone", not the site.
// Same segmented shape as PostTypePicker — the server re-decides in
// lib/zones/post-access.ts.

import { useTranslations } from 'next-intl';
import { Globe, KeyRound, Users, type LucideIcon } from 'lucide-react';
import { ZONE_POST_VISIBILITIES, type ZonePostVisibilityValue } from '@/lib/zones/shared';

export const VISIBILITY_ICONS: Record<ZonePostVisibilityValue, LucideIcon> = {
  zone: Globe,
  members: Users,
  restricted: KeyRound,
};

export function VisibilityPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: ZonePostVisibilityValue;
  onChange: (next: ZonePostVisibilityValue) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');

  return (
    <div>
      <div
        role="radiogroup"
        aria-label={t('composer_visibility_label')}
        className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {ZONE_POST_VISIBILITIES.map((v) => {
          const Icon = VISIBILITY_ICONS[v];
          const on = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                on
                  ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tl(`zonePostVisibility.${v}`)}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">{t(`composer_visibility_desc_${value}`)}</p>
    </div>
  );
}
