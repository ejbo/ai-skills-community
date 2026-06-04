import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

export interface Crumb {
  label: string;
  href?: string;
}

// Path-reflecting breadcrumb shown under the navbar on every video page, so
// users can step back up a level (each parent crumb is a link).
export function VideoBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1 text-sm text-muted">
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden />}
            {c.href && !last ? (
              <Link
                href={c.href}
                className="shrink-0 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {c.label}
              </Link>
            ) : (
              <span className={`truncate ${last ? 'font-medium text-zinc-900 dark:text-zinc-100' : ''}`}>
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
