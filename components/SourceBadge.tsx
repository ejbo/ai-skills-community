import { Lock, Leaf, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Source = 'internal' | 'external' | 'curated';

/**
 * Where a skill came from is a fact about the skill, not decoration, and the
 * three sources are told apart at a glance by hue long before anyone reads the
 * 11px label. Tints are the 50/500-15 pair so the pill stays a whisper on a
 * white card and never becomes a solid block of colour.
 */
const STYLES: Record<Source, { icon: React.ReactNode; tKey: string; cls: string }> = {
  internal: {
    icon: <Lock className="h-3 w-3" />,
    tKey: 'internal',
    cls: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  external: {
    icon: <Leaf className="h-3 w-3" />,
    tKey: 'external',
    cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  curated: {
    icon: <ExternalLink className="h-3 w-3" />,
    tKey: 'curated',
    cls: 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
};

export function SourceBadge({ source }: { source: Source }) {
  const t = useTranslations('source');
  const cfg = STYLES[source];
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${cfg.cls}`}
    >
      {cfg.icon}
      {t(cfg.tKey)}
    </span>
  );
}
