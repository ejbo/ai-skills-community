import Link from 'next/link';
import { Sparkles } from 'lucide-react';

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
}) {
  return (
    <div className="surface flex flex-col items-center justify-center rounded-2xl px-8 py-16 text-center">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900/[0.06] dark:bg-white/10 text-zinc-900 dark:text-zinc-50">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-xs text-sm text-muted">{description}</p>}
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 inline-flex h-9 items-center rounded-lg bg-zinc-900 dark:bg-zinc-100 px-4 text-sm font-medium text-white dark:text-zinc-900 transition hover:bg-zinc-700 dark:hover:bg-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 dark:focus-visible:ring-zinc-100 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-950"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
