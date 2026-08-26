import { Zap } from 'lucide-react';

/**
 * Token cost is a threshold, not a category: cheap skills stay quiet in ink and
 * only an expensive one earns colour. That keeps a grid of cards calm while
 * still flagging the handful that will eat a context window.
 */
function toneFor(tokens: number): string {
  if (tokens >= 3000) return 'text-danger';
  if (tokens >= 1000) return 'text-warn';
  return 'text-zinc-500 dark:text-zinc-400';
}

export function TokenCostBadge({ tokens, compact = false }: { tokens: number; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-xs tabular-nums ${toneFor(tokens)}`}
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
