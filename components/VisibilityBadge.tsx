import { Globe, Lock, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SkillVisibility } from '@prisma/client';

/**
 * Visibility is a gate, so it is colour-coded like one: open (green),
 * gated (amber), closed (grey). Same tint weight as SourceBadge so the two
 * pills sit together without one shouting over the other.
 */
const CONFIG: Record<SkillVisibility, { Icon: typeof Globe; cls: string }> = {
  public: {
    Icon: Globe,
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  restricted: {
    Icon: ShieldCheck,
    cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  private: {
    Icon: Lock,
    cls: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
  },
};

/** Small pill showing a skill's visibility. Public is hidden unless showPublic. */
export function VisibilityBadge({
  visibility,
  showPublic = false,
}: {
  visibility: SkillVisibility;
  showPublic?: boolean;
}) {
  const tl = useTranslations('labels');
  if (visibility === 'public' && !showPublic) return null;
  const { Icon, cls } = CONFIG[visibility];
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${cls}`}
    >
      <Icon className="h-3 w-3" />
      {tl(`visibility.${visibility}`)}
    </span>
  );
}
