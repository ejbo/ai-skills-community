import { Zap } from 'lucide-react';

export function TokenCostBadge({ tokens, compact = false }: { tokens: number; compact?: boolean }) {
  const colorClass =
    tokens < 1000
      ? 'text-ok'
      : tokens < 3000
        ? 'text-warn'
        : 'text-danger';
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono tabular-nums text-xs ${colorClass}`}
      title={`Estimated ${tokens.toLocaleString()} tokens when activated`}
      aria-label={`Token cost: ${tokens} tokens`}
    >
      <Zap className="h-3 w-3" fill="currentColor" />
      {formatTokens(tokens, compact)}
    </span>
  );
}

function formatTokens(n: number, compact: boolean): string {
  if (compact && n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}
