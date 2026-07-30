import { Globe, Lock, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SkillVisibility } from '@prisma/client';

const CONFIG: Record<SkillVisibility, { Icon: typeof Globe; cls: string }> = {
  public: { Icon: Globe, cls: 'bg-ok/10 text-ok' },
  restricted: { Icon: ShieldCheck, cls: 'bg-warn/10 text-warn' },
  private: {
    Icon: Lock,
    cls: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
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
    <span className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {tl(`visibility.${visibility}`)}
    </span>
  );
}
