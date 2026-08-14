import { Lock, Leaf, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Source = 'internal' | 'external' | 'curated';

// Three tinted hues in one 11px slot (next to VisibilityBadge, next to
// TokenCostBadge) was the confetti that made every card list look busy. The
// icon and the label already say which source this is, so the pill is neutral
// and the distinction survives without colour.
const STYLES: Record<Source, { icon: React.ReactNode; tKey: string }> = {
  internal: { icon: <Lock className="h-3 w-3" />, tKey: 'internal' },
  external: { icon: <Leaf className="h-3 w-3" />, tKey: 'external' },
  curated: { icon: <ExternalLink className="h-3 w-3" />, tKey: 'curated' },
};

export function SourceBadge({ source }: { source: Source }) {
  const t = useTranslations('source');
  const cfg = STYLES[source];
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-zinc-100 px-2 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
      {cfg.icon}
      {t(cfg.tKey)}
    </span>
  );
}
