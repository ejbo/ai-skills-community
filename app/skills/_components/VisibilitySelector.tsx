'use client';

import { Globe, ShieldCheck, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SkillVisibility } from '@prisma/client';

const OPTIONS: { value: SkillVisibility; Icon: typeof Globe }[] = [
  { value: 'public', Icon: Globe },
  { value: 'restricted', Icon: ShieldCheck },
  { value: 'private', Icon: Lock },
];

export function VisibilitySelector({
  value,
  onChange,
}: {
  value: SkillVisibility;
  onChange: (v: SkillVisibility) => void;
}) {
  const t = useTranslations('skills_misc');
  const tl = useTranslations('labels');
  // "受限下载" is intentionally more explicit than the generic labels.visibility.restricted.
  const label = (v: SkillVisibility) =>
    v === 'restricted' ? t('visibility_restricted_label') : tl(`visibility.${v}`);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map(({ value: v, Icon }) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition ${
              value === v
                ? 'border-zinc-900 dark:border-zinc-100 bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50'
                : 'border-zinc-300 hover:border-zinc-400 dark:border-zinc-700'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label(v)}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted">{t(`visibility_help_${value}`)}</p>
    </div>
  );
}
