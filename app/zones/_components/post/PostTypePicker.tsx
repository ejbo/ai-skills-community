'use client';

// 帖子类型 segmented control (mono). `announcement` is offered only to
// moderators (the API re-checks). Icons are shared with PostHeader / cards.

import { useTranslations } from 'next-intl';
import { FileText, GraduationCap, Link2, Megaphone, Presentation, ScrollText, type LucideIcon } from 'lucide-react';
import { ZONE_POST_TYPES_FOR_AUTHORS, type ZonePostTypeValue } from '@/lib/zones/shared';

export const POST_TYPE_ICONS: Record<ZonePostTypeValue, LucideIcon> = {
  article: FileText,
  report: ScrollText,
  paper: GraduationCap,
  slides: Presentation,
  link: Link2,
  announcement: Megaphone,
};

export function PostTypePicker({
  value,
  onChange,
  canAnnounce,
  disabled = false,
}: {
  value: ZonePostTypeValue;
  onChange: (type: ZonePostTypeValue) => void;
  canAnnounce: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('zones');
  const tl = useTranslations('labels');
  const options: ZonePostTypeValue[] = canAnnounce ? [...ZONE_POST_TYPES_FOR_AUTHORS, 'announcement'] : [...ZONE_POST_TYPES_FOR_AUTHORS];

  return (
    <div>
      <div role="radiogroup" aria-label={t('composer_type_label')} className="inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-900">
        {options.map((type) => {
          const Icon = POST_TYPE_ICONS[type];
          const on = type === value;
          return (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              onClick={() => onChange(type)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                on
                  ? 'bg-zinc-900 text-white shadow-sm dark:bg-zinc-50 dark:text-zinc-900'
                  : 'text-zinc-600 hover:bg-white hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tl(`zonePostType.${type}`)}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted">{t(`composer_type_desc_${value}`)}</p>
    </div>
  );
}
