import { Download, Heart, Star, Bell } from 'lucide-react';
import { TokenCostBadge } from './TokenCostBadge';

export interface SkillStats {
  downloads: number;
  likes: number;
  rating?: number;
  reviewCount?: number;
  subscribers?: number;
  tokens?: number;
}

export function StatRow({ stats }: { stats: SkillStats }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
      <Stat icon={<Download className="h-3 w-3" />} value={formatCount(stats.downloads)} />
      <Stat icon={<Heart className="h-3 w-3" />} value={formatCount(stats.likes)} />
      {typeof stats.rating === 'number' && stats.rating > 0 && (
        <Stat
          icon={<Star className="h-3 w-3" fill="currentColor" />}
          value={`${stats.rating.toFixed(1)}${stats.reviewCount ? ` (${stats.reviewCount})` : ''}`}
        />
      )}
      {typeof stats.subscribers === 'number' && stats.subscribers > 0 && (
        <Stat icon={<Bell className="h-3 w-3" />} value={formatCount(stats.subscribers)} />
      )}
      {typeof stats.tokens === 'number' && stats.tokens > 0 && (
        <TokenCostBadge tokens={stats.tokens} compact />
      )}
    </div>
  );
}

function Stat({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
      {icon}
      {value}
    </span>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}
