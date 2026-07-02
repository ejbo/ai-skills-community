import { Lock, Leaf, ExternalLink } from 'lucide-react';
import { useTranslations } from 'next-intl';

type Source = 'internal' | 'external' | 'curated';

const STYLES: Record<Source, { color: string; bg: string; icon: React.ReactNode; tKey: string }> = {
  internal: {
    color: 'text-source-internal',
    bg: 'bg-source-internal/10',
    icon: <Lock className="h-3 w-3" />,
    tKey: 'internal',
  },
  external: {
    color: 'text-source-external',
    bg: 'bg-source-external/10',
    icon: <Leaf className="h-3 w-3" />,
    tKey: 'external',
  },
  curated: {
    color: 'text-source-curated',
    bg: 'bg-source-curated/10',
    icon: <ExternalLink className="h-3 w-3" />,
    tKey: 'curated',
  },
};

export function SourceBadge({ source }: { source: Source }) {
  const t = useTranslations('source');
  const cfg = STYLES[source];
  return (
    <span
      className={`inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium ${cfg.color} ${cfg.bg}`}
    >
      {cfg.icon}
      {t(cfg.tKey)}
    </span>
  );
}
