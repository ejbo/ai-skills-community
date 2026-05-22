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
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-500/15 text-accent-600">
        <Sparkles className="h-5 w-5" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-xs text-sm text-muted">{description}</p>}
      {actionLabel && actionHref && (
        <Link
          href={actionHref}
          className="mt-4 rounded-lg bg-accent-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-600"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
