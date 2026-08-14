import { Globe, Lock, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SkillVisibility } from '@prisma/client';

// Neutral on purpose: restricted skills reach public listings (the browse
// filter is `visibility: { not: 'private' }`), so the amber pill used to be the
// one warm spot on an otherwise grey card grid. Icon plus label carry it.
const CONFIG: Record<SkillVisibility, { Icon: typeof Globe }> = {
  public: { Icon: Globe },
  restricted: { Icon: ShieldCheck },
  private: { Icon: Lock },
};

const PILL =
  'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';

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
  const { Icon } = CONFIG[visibility];
  return (
    <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${PILL}`}>
      <Icon className="h-3 w-3" />
      {tl(`visibility.${visibility}`)}
    </span>
  );
}
