import { Zap } from 'lucide-react';

export function TokenCostBadge({ tokens, compact = false }: { tokens: number; compact?: boolean }) {
  // Green/amber/red on a 12px glyph next to two other pills read as decoration,
  // not as a threshold anyone acts on. The number is the data.
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
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
